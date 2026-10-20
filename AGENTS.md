# Dfit Studio: project context

Read this first. It is the hand-off from the earlier chat sessions, so a new assistant or developer can continue without the history.

## What this is

A mobile-first PWA for class scheduling at Dfit Studio, a weight-training studio (about 100 students, about 7 classes a day, Monday to Friday). Later goals: payments, registration, several studios. The owner is Bryan. The student-facing UI is in Brazilian Portuguese (pt-BR).

## Stack and layout

pnpm monorepo, Node 22. Use pnpm 10 (the lockfile was made with 10.28; pnpm 12 rejects very recent packages).

- `apps/api`: Fastify 5, Drizzle ORM, Postgres 16, zod, jose (JWT), argon2 (@node-rs/argon2), luxon. SQL migrations in `apps/api/drizzle`.
- `apps/web`: Vite, React 19, TypeScript, Tailwind 4, vite-plugin-pwa, react-router, Sonner toasts, Montserrat (via @fontsource-variable). Tests: Vitest and Testing Library.
- In production one service serves both: the API serves the built web app (`WEB_DIR`), so everything is one origin and the login cookie needs no cross-site settings. In development the Vite dev server proxies API paths (`/auth /me /sessions /bookings /staff /health`) to `API_URL` (default `http://localhost:3000`).

## Commands

```sh
pnpm install
docker compose up -d db                         # Postgres on localhost:5432
cp .env.example .env
pnpm --filter @dfit/api db:migrate
pnpm --filter @dfit/api db:seed                 # studio "dfit" and its first owner (SEED_OWNER_EMAIL/PASSWORD)
pnpm --filter @dfit/api db:seed:dev             # local only: Mon-Fri timetable and student aluno@dfit.test / senha1234
pnpm dev:api    # http://localhost:3000
pnpm dev:web    # http://localhost:5173
pnpm --filter @dfit/web test                    # Vitest, no backend needed
DATABASE_URL=... pnpm --filter @dfit/api test   # needs a migrated Postgres; skipped without DATABASE_URL
pnpm typecheck
```

On Windows PowerShell set variables as `$env:DATABASE_URL="..."` before the command.

## Domain rules worth knowing

- Roles: owner, staff, student. A student signs up (pending), staff approve, then set the weekly limit (an "agreement"). Staff can also create a student directly (Novo aluno) with a one-time temporary password; the student must change it at first login (`mustChangePassword`).
- Auth: 15-minute access JWT kept in memory; 30-day refresh token in an HttpOnly cookie on path `/auth`, rotated on use (replaying an old one logs the user out everywhere).
- Every class occurrence is a `class_sessions` row with a seat counter; every seat is a `bookings` row. Rules (weekly limit, capacity, cancel cutoff) are enforced in short DB transactions. Class sessions are generated ahead of time from `class_slots` by a daily job (`GENERATION_HOUR`, also runs at startup).
- Time zone: studio time zone (`America/Sao_Paulo`, from the studio row; web uses `VITE_STUDIO_TIMEZONE`). Days are handled as `YYYY-MM-DD` strings in that zone, never in the phone's zone.
- The calendar in the app shows Sunday to Saturday, and the weekly class limit counts the same Sunday to Saturday week (server-side, `weekBounds` in `apps/api/src/booking/time.ts`).
- Fixed classes (`standing_enrollments`): staff assign them directly (`/equipe/alunos` > Horário fixo) or approve a student's request (`standing_requests`, section "Horário fixo" of `/equipe/solicitacoes`; a student can ask to join, leave or move). A student can hold at most as many fixed classes as their weekly limit (`fixed_limit_reached`); raise the limit first. A full class is refused unless staff explicitly accept it (`allowOverCapacity`): the session's capacity then grows by one, the enrollment remembers the okay so the daily job does the same for new sessions, and the extra seat stays after that student leaves. Approved changes and removals take effect immediately: classes still to come are cancelled at once, classes that already started are kept. Logic in `apps/api/src/booking/standing.ts`.
- Deleting a row in `users` (for example from drizzle-kit studio) cascades to its memberships, refresh tokens, student row, agreements, fixed classes, requests and bookings (migration 0006). `created_by`, `decided_by`, `instructor_id` and `replaces_booking_id` are set to null instead. A trigger on `bookings` gives the class seat back when a non-cancelled booking is deleted, so `booked_count` stays right. There is no delete or deactivate feature in the app yet.
- Staff routes live in `apps/api/src/routes/{staff,schedule}.ts`; student routes in `bookings.ts`; auth in `auth.ts`. The README has the route table.

## Design decisions from the original proposal

Source: `dfit-studio-scheduling-system-proposal.md` (decisions settled by Bryan on 2026-10-15).

- PWA first, no Next.js; native apps (Capacitor or Expo) only if a real need appears. Mobile-first at 360-400px.
- Multi-studio readiness: `studio_id` on every business table, tenant resolved once per request from the user's membership, users are global with per-studio memberships. Postgres Row-Level Security only once a second studio exists. Studio rules (time zone, booking weekdays, booking window, cancel cutoff, self-registration) are settings, not code.
- Settled answers: self-registration is open with staff approval; cancel and swap cutoff is 1 hour before class; unused weekly classes do not carry over. The proposal said the limit week is Monday to Friday; Bryan later decided it runs Sunday to Saturday.
- The booking transaction order matters (avoid deadlocks): lock the student row (`FOR UPDATE`), check the weekly limit, claim the seat with `UPDATE class_sessions SET booked_count = booked_count + 1 WHERE status = 'scheduled' AND booked_count < capacity`, then insert the booking. The `CHECK (booked_count <= capacity)` and the partial unique index on `(session_id, student_id) WHERE status = 'booked'` are safety nets. A swap cancels and books in one transaction, so the original seat is never lost. Lock sessions by id order.
- Proposed but possibly not built: idempotency key per booking request, TanStack Query with refetch on focus and every 30 s, capacity override by staff (logged), `standing_enrollments` (fixed schedule that auto-creates bookings), `agreements` with `valid_from/valid_to` history, a concurrency test (50 simultaneous bookings on capacity 10, exactly 10 succeed). Check the schema in `apps/api/src/db` before assuming any of these exist.

### Roadmap

1. Phase 0, Foundations: monorepo, deploys, auth, tenant-aware schema.
2. Phase 1, Scheduling MVP (current): sign-up/approval, week view, book/cancel/swap, request a permanent slot change; staff manage timetable, agreements, fixed schedules, rosters, class cancellation. Done when Dfit runs a full month with zero overbookings.
3. Phase 2, Operations: waitlist with auto-promotion, notifications (push/email/WhatsApp), attendance and no-show, simple reports.
4. Phase 3, Business: plans and payments, overdue alerts, richer profiles (health data is sensitive; mind privacy law, LGPD).
5. Phase 4, Product: self-service studio onboarding, subdomains and branding, RLS on, studio billing, marketing site.

## Web conventions

- Screens: `/entrar`, `/cadastro`, `/trocar-senha`, `/` (week view: students book, cancel, swap; staff see classes), `/minhas-aulas` (student bookings and "Meu horário fixo": fixed classes and change requests), `/equipe/solicitacoes` (everything waiting for staff: new sign-ups to approve and fixed-class requests; the old `/equipe/aprovacoes` and `/equipe/pedidos` redirect there), `/equipe/alunos`, `/equipe/alunos/novo`, `/equipe/aulas/:id` (roster; add/remove students, cancel class).
- Design: minimal dark theme from the Dfit logo. Tokens in `apps/web/src/index.css`: ink `#020002`, surface `#0e0b12`, line `#6f687a`, muted `#a59fae`, brand pink `#e41464` / light `#ff5c95`, violet `#6a1bb8`, danger `#ff6b6b`, success `#3ddc84`. The pink-to-violet gradient is for primary buttons and highlights only.
- Custom `Select` component (ARIA combobox) instead of native selects; thin gray scrollbar class `slim-scroll`.
- Toasts: `lib/notify.ts` (`notifySuccess`, `notifyError`); errors are red text, border and icon on the normal dark toast background.
- User-facing error text is in `lib/messages.ts` (`errorMessage`, `staffErrorMessage`); add a case there for every new API error code.
- Tests mock `fetch` with a route map keyed `"METHOD /path"` (see `App.test.tsx`). Week tests fake only `Date`.

## Deployment

- `Dockerfile` builds both apps into one image; `render.yaml` is a Render Blueprint (one web service + free Postgres). The container runs `start:prod`: migrations, owner seed, optional timetable seed, then the server.
- Required env on the host: `DATABASE_URL`, `JWT_SECRET` (32+ chars, different from local), `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`. Optional: `SEED_DEFAULT_TIMETABLE=true` (+ `SEED_CLASS_TIMES`, `SEED_CLASS_CAPACITY`, `SEED_CLASS_NAME`) to create a first timetable when the studio has none; remove it afterwards.
- Render free tier sleeps after 15 idle minutes and its free database expires after 30 days. Fine for testing, not for launch. Fly.io (São Paulo region) was the suggested home for the real studio.
- Connect to the Render database from a laptop with the External Database URL plus `?sslmode=require` (for example `drizzle-kit studio`). The Internal URL only works inside Render. Never paste the URL or password in chats or commit it.

## Things that went wrong before

- Never leave a stale `.git/index.lock`; don't run git in the same folder from two tools at once.
- Migrations path on Windows must use `fileURLToPath`, not `new URL().pathname`.
- API tests include a rate-limit test, so a 429 log line in test output is expected.
- Sonner toast text is rendered twice in tests (toast plus live region); use `findAllByText` for toast text.

## Not built yet / open

- Install banner for the PWA (Android prompt button, iPhone "Add to Home Screen" hint). On hold at Bryan's request.
- Payments, multi-studio (studio would come from the subdomain), staff account creation screen, student history (past classes).
