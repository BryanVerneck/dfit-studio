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
- The calendar in the app shows Sunday to Saturday, but the weekly class limit still counts Monday to Sunday (server-side). Moving the limit week is an open question.
- Staff routes live in `apps/api/src/routes/{staff,schedule}.ts`; student routes in `bookings.ts`; auth in `auth.ts`. The README has the route table.

## Web conventions

- Screens: `/entrar`, `/cadastro`, `/trocar-senha`, `/` (week view: students book, cancel, swap; staff see classes), `/minhas-aulas` (student bookings), `/equipe/aprovacoes`, `/equipe/alunos`, `/equipe/alunos/novo`, `/equipe/aulas/:id` (roster; add/remove students, cancel class).
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
- Decide whether the weekly limit week should also run Sunday to Saturday.
- Payments, multi-studio (studio would come from the subdomain), staff account creation screen, student history (past classes).
