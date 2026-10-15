import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { bookingRoutes } from "./routes/bookings.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { staffRoutes } from "./routes/staff.js";

// Paths that belong to the API. Everything else is the web app, so a refresh on /equipe/alunos still loads it.
const API_PREFIXES = ["/auth", "/me", "/sessions", "/bookings", "/staff", "/health"];

export function buildApp({ db, config, webDir }: { db: Db; config: Config; webDir?: string }) {
  const app = Fastify({ logger: true, trustProxy: config.trustProxy });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: err.code });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    }
    return reply.send(err);
  });

  app.register(cookie);
  app.register(rateLimit, { global: false });

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes(config, db));
  app.register(staffRoutes(config, db));
  app.register(scheduleRoutes(config, db));
  app.register(bookingRoutes(config, db));

  // In production one service serves both the API and the built web app, so they share an origin
  // and the login cookie needs no cross-site settings.
  if (webDir) {
    app.register(fastifyStatic, {
      root: webDir,
      cacheControl: false,
      setHeaders(reply, filePath) {
        const immutable = /[\\/]assets[\\/]/.test(filePath);
        reply.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const isApi = API_PREFIXES.some((p) => request.url === p || request.url.startsWith(`${p}/`) || request.url.startsWith(`${p}?`));
      // A missing file (like an old /assets/app.js) must stay a 404, not turn into the app's HTML.
      const looksLikeFile = /\.[a-z0-9]+$/i.test(request.url.split("?")[0]);
      if (request.method === "GET" && !isApi && !looksLikeFile) {
        return reply.header("Cache-Control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }

  return app;
}
