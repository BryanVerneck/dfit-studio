# Dfit Studio

Class scheduling for Dfit Studio. Monorepo managed with pnpm workspaces.

## Layout

- `apps/api`: Node.js + TypeScript backend (Fastify). Currently a skeleton with a health check.

## Getting started

```sh
pnpm install
pnpm --filter @dfit/api test
pnpm --filter @dfit/api dev
```

Then open http://localhost:3000/health.

Copy `.env.example` to `.env` before running anything that needs the database.
