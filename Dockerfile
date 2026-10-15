FROM node:22-slim
# Same pnpm version the lockfile was made with; newer major versions reject very recent packages.
RUN npm install -g pnpm@10.28.0
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    WEB_DIR=/app/apps/web/dist \
    TRUST_PROXY=true
EXPOSE 3000
# Applies migrations and makes sure the studio and its owner exist, then starts the server.
CMD ["pnpm", "--filter", "@dfit/api", "start:prod"]
