# Dfit Studio

Class scheduling for Dfit Studio. Monorepo managed with pnpm workspaces.

## Layout

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
| `POST /staff/bookings` | staff, owner | Book a student into a class |
| `POST /staff/students/:studentId/agreement` | staff, owner | Set the weekly class limit (history is kept) |
| `POST /staff/students/:studentId/standing-enrollments` | staff, owner | Put a student on a fixed weekly class |
| `POST /staff/standing-enrollments/:id/end` | staff, owner | End a fixed class from a date; a permanent change of time is this plus a new enrollment |

Students need an agreement (weekly limit) before they can book. Session generation is idempotent and meant to run daily; a scheduled job for it is not set up yet, so for now staff run `POST /staff/sessions/generate`.

Forgot password: staff issue a temporary password and the student must replace it at next login. An emailed reset link is planned for a later phase.

After changing `src/db/schema.ts`, run `pnpm --filter @dfit/api db:generate` to create a new migration and commit it.
