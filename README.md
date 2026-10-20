# Dfit Studio

Class scheduling for Dfit Studio. Monorepo managed with pnpm workspaces.

## Layout

- `apps/web`: React + TypeScript web app (Vite, Tailwind CSS), set up as an installable PWA. Currently a placeholder page.
- `apps/api`: Node.js + TypeScript backend (Fastify) with a PostgreSQL schema managed by Drizzle.
  - `src/db/schema.ts`: tables for studios, users, memberships, students, agreements, class slots, class sessions, standing enrollments and bookings.
  - `drizzle/`: generated SQL migrations.

## Getting started

```sh
pnpm install
docker compose up -d db                # PostgreSQL 16 on localhost:5432
cp .env.example .env
export DATABASE_URL=postgres://dfit:dfit@localhost:5432/dfit
pnpm --filter @dfit/api db:migrate     # apply migrations
pnpm --filter @dfit/api db:seed        # create the studio and its first owner
pnpm --filter @dfit/api test           # database tests run when DATABASE_URL is set
pnpm --filter @dfit/api dev
```

Then open http://localhost:3000/health.

## Web app

```sh
pnpm dev:api    # backend on http://localhost:3000
pnpm dev:web    # web app on http://localhost:5173
pnpm --filter @dfit/web test
pnpm --filter @dfit/web build
```

In development the browser only talks to the web dev server, which forwards the API routes (`/auth`, `/me`, `/sessions`, `/bookings`, `/staff`, `/health`) to the backend. Keeping a single origin means the login cookie works exactly as it will in production. Set `API_URL` to point at a backend other than `http://localhost:3000`.

The app is an installable PWA: `pnpm --filter @dfit/web build` generates the web manifest and a service worker, and `pnpm --filter @dfit/web preview` serves that production build. The service worker never caches API responses, so spots left and bookings are always current. The icons in `apps/web/public` are placeholders to replace with Dfit's logo.

## Login

Email and password. Passwords are stored only as argon2 hashes. A login returns a 15-minute access token (JWT, send it as `Authorization: Bearer ...`) and sets a 30-day refresh token in an `HttpOnly` cookie scoped to `/auth`. Each refresh rotates the token; replaying an already-used token logs that user out everywhere.

| Route | Who | What |
| --- | --- | --- |
| `POST /auth/register` | anyone | Student signs up; stays `pending` until approved |
| `POST /auth/login` | anyone | Returns the access token and sets the refresh cookie |
| `POST /auth/refresh` | cookie | Rotates the refresh token, returns a new access token |
| `POST /auth/logout` | cookie | Revokes the refresh token |
| `POST /auth/change-password` | logged in | Required after a temporary password |
| `GET /me` | logged in | Current user |
| `GET /staff/pending-students` | staff, owner | Signups waiting for approval |
| `POST /staff/students` | staff, owner | Creates an active student with a weekly limit and a one-time temporary password |
| `POST /staff/students/:userId/approve` | staff, owner | Activates the student |
| `POST /staff/users/:userId/temporary-password` | staff (students), owner (anyone) | Returns a one-time temporary password |

## Booking

Every class occurrence is a row (`class_sessions`) with a seat counter, and every seat is a booking. The rules are enforced inside one short database transaction per request:

1. The student's row is locked, so two taps or two devices cannot both slip under the weekly limit.
2. The weekly limit is checked (the booking week is Monday to Sunday in the studio's time zone, using the agreement valid on the class date).
3. The seat is taken with a single `UPDATE ... WHERE booked_count < capacity`, so two requests for the last seat can never both succeed.
4. The booking row is inserted. Any failure rolls everything back, including the seat count.

A swap cancels the original and books the new class in the same transaction, so the student keeps the original if the swap fails. Booking and swapping accept an `Idempotency-Key` header (or `idempotencyKey` in the body) so a retry on a bad connection does not book twice.

| Route | Who | What |
| --- | --- | --- |
| `GET /sessions?from&to` | logged in | Classes with `spotsLeft`; students also get `myBookingId` |
| `POST /bookings` | student | Book a class (`sessionId`) |
| `DELETE /bookings/:id` | student (until the cutoff), staff (any time) | Cancel a booking |
| `POST /bookings/:id/swap` | student | One-off swap to another class (`toSessionId`) |
| `GET /me/bookings` | student | Upcoming bookings |
| `GET /me/weekly-usage?date` | student | Classes used and remaining in that week |
| `POST /staff/slots`, `GET /staff/slots` | staff, owner | The weekly timetable |
| `POST /staff/sessions/generate` | staff, owner | Create sessions for the coming days and book fixed schedules into them |
| `GET /staff/sessions/:id/roster` | staff, owner | Who is booked in a class |
| `POST /staff/sessions/:id/cancel` | staff, owner | Cancel one class (holiday, instructor out); cancels its bookings and lists the students to tell |
| `POST /staff/sessions/cancel-day` | staff, owner | Cancel every class still scheduled on a date (`date`, optional `note`) |
| `POST /staff/bookings` | staff, owner | Book a student into a class |
| `POST /staff/students/:studentId/agreement` | staff, owner | Set the weekly class limit (history is kept) |
| `POST /staff/students/:studentId/standing-enrollments` | staff, owner | Put a student on a fixed weekly class. Refused with `fixed_limit_reached` when the student already has as many fixed classes as their weekly limit, and with `class_full` unless `allowOverCapacity: true` |
| `GET /staff/standing-enrollments` | staff, owner | Open fixed classes of all students |
| `GET /staff/standing-requests` | staff, owner | Pending student requests to join, leave or move between fixed classes, with how full the requested class is |
| `POST /staff/standing-requests/:id/approve` | staff, owner | Apply a request now (or from `effectiveFrom`); `allowOverCapacity: true` accepts a full class |
| `POST /staff/standing-requests/:id/reject` | staff, owner | Refuse a request, with an optional `decisionNote` the student reads |
| `GET /me/slots`, `GET /me/standing-enrollments`, `GET /me/standing-requests` | student | The timetable, the student's fixed classes and their requests |
| `POST /me/standing-requests` | student | Ask to join (`toSlotId`), leave (`fromEnrollmentId`) or move (both) |
| `POST /me/standing-requests/:id/cancel` | student | Withdraw a pending request |
| `POST /staff/standing-enrollments/:id/end` | staff, owner | End a fixed class from a date; a permanent change of time is this plus a new enrollment |

Students need an agreement (weekly limit) before they can book.

### Cancelling classes

Cancelling a class marks it `cancelled` and cancels every active booking in it. Those bookings stop counting toward the weekly limit, so students can book another class that week. Students no longer see the class in `GET /sessions` (staff still do, marked `cancelled`), and `GET /me/bookings` keeps the cancelled booking with `cancelReason: "class_cancelled"` and the staff note, so a student can see why it disappeared. The response lists the affected students (name and phone) so staff can tell them; there are no automatic notifications yet. Generating sessions again never brings a cancelled class or its bookings back. Attended and no-show records are kept.

Locks are always taken in the same order (student, then class row, then booking rows), so cancelling a class cannot deadlock with a student cancelling, booking or swapping at the same moment.

### Daily session generation

The API creates the coming weeks' class sessions, and books each student's fixed schedule into them, by itself:

- When the server starts it runs once for every studio, to catch up after any downtime.
- Then it checks every 15 minutes and runs for each studio during 03:00 to 03:59 in that studio's own time zone, once per day.
- It is safe to run at any time and from several server instances at once: a database lock lets only one instance work while the others skip, and existing sessions and bookings are never duplicated.
- If one studio fails, the others still run, and the failed one is retried on the next check while its hour lasts. Look for `session generation finished` / `failed` in the logs.

`POST /staff/sessions/generate` still runs it on demand for the staff member's studio (for example right after changing the timetable). Set `GENERATION_HOUR` to change the hour, or `DISABLE_SCHEDULER=true` to turn the built-in scheduler off (for example to run it from an external cron instead).

Forgot password: staff issue a temporary password and the student must replace it at next login. An emailed reset link is planned for a later phase.

After changing `src/db/schema.ts`, run `pnpm --filter @dfit/api db:generate` to create a new migration and commit it.

## Deploying

The Dockerfile builds the API and the web app into one image. The API serves the web app, so both share one address and the login cookie works without any cross-site settings. On start it applies migrations and makes sure the studio and its owner exist (`start:prod`).

`render.yaml` describes the setup for Render (one web service plus Postgres): New > Blueprint, pick this repository, and enter `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` when asked. `JWT_SECRET` is generated and `DATABASE_URL` is wired automatically. Any host that runs a Docker image works the same way with these variables: `DATABASE_URL`, `JWT_SECRET` (32+ characters), `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`; `NODE_ENV=production`, `TRUST_PROXY=true` and `WEB_DIR` are already set in the image.

Render's free plan puts the service to sleep after 15 idle minutes (the first request afterwards takes about a minute, and class sessions are generated again on wake-up) and its free database expires after 30 days, so it suits testing, not the real studio.

To give a new deployment its first timetable, set `SEED_DEFAULT_TIMETABLE=true` (optionally `SEED_CLASS_TIMES="06:00,07:00"`, `SEED_CLASS_CAPACITY=8`, `SEED_CLASS_NAME=Treino`) and restart. It creates Monday to Friday class slots only when the studio has none, then generates the upcoming sessions. Remove the variable afterwards.
