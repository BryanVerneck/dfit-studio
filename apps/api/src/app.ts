import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { staffRoutes } from "./routes/staff.js";

export function buildApp({ db, config }: { db: Db; config: Config }) {
  const app = Fastify({ logger: true, trustProxy: config.trustProxy });

  app.setErrorHandler((err, _request, reply) => {
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

  return app;
}
