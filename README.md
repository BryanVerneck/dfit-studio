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

Forgot password: staff issue a temporary password and the student must replace it at next login. An emailed reset link is planned for a later phase.

After changing `src/db/schema.ts`, run `pnpm --filter @dfit/api db:generate` to create a new migration and commit it.
