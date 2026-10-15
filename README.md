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
pnpm --filter @dfit/api test           # database tests run when DATABASE_URL is set
pnpm --filter @dfit/api dev
```

Then open http://localhost:3000/health.

After changing `src/db/schema.ts`, run `pnpm --filter @dfit/api db:generate` to create a new migration and commit it.
