import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/guard.js";
import { isUniqueViolation } from "../auth/errors.js";
import { dummyHash, hashPassword, verifyPassword } from "../auth/password.js";
import { hashRefreshToken, newRefreshToken, signAccessToken, type Role } from "../auth/tokens.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { memberships, refreshTokens, studios, users } from "../db/schema.js";

const REFRESH_COOKIE = "refresh_token";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);

const registerBody = z.object({
  studioSlug: z.string().min(1),
  email,
  password,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  gender: z.string().trim().max(40).optional(),
});
const loginBody = z.object({ email, password: z.string().min(1).max(128), studioSlug: z.string().min(1).optional() });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

export function authRoutes(config: Config, db: Db) {
  return async (app: FastifyInstance) => {
    const limited = { config: { rateLimit: { max: config.authRateLimitPerMinute, timeWindow: "1 minute" } } };

    async function startSession(
      reply: FastifyReply,
      user: { id: string; mustChangePassword: boolean },
      membership: { studioId: string; role: Role },
    ) {
      const refreshToken = newRefreshToken();
      const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000);
      await db.insert(refreshTokens).values({
        userId: user.id,
        studioId: membership.studioId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      });
      reply.setCookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "lax",
        path: "/auth",
        expires: expiresAt,
      });
      return {
        accessToken: await signAccessToken(config, {
          userId: user.id,
          studioId: membership.studioId,
          role: membership.role,
          mustChangePassword: user.mustChangePassword,
        }),
        expiresIn: config.accessTokenTtlSeconds,
        role: membership.role,
        studioId: membership.studioId,
        mustChangePassword: user.mustChangePassword,
      };
    }

    const revokeAll = (userId: string) =>
      db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    app.post("/auth/register", limited, async (request, reply) => {
      const body = registerBody.parse(request.body);
      const [studio] = await db.select().from(studios).where(eq(studios.slug, body.studioSlug));
      if (!studio) return reply.code(404).send({ error: "studio_not_found" });
      const passwordHash = await hashPassword(body.password);
      try {
        await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({ email: body.email, name: body.name, phone: body.phone, gender: body.gender, passwordHash })
            .returning({ id: users.id });
          await tx.insert(memberships).values({ studioId: studio.id, userId: user.id, role: "student", status: "pending" });
        });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send({ error: "email_taken" });
        throw err;
      }
      return reply.code(201).send({ status: "pending_approval" });
    });

    app.post("/auth/login", limited, async (request, reply) => {
      const body = loginBody.parse(request.body);
      const [user] = await db.select().from(users).where(eq(users.email, body.email));
      // Always run one hash verification so unknown emails take as long as wrong passwords.
      const ok = await verifyPassword(user ? user.passwordHash : await dummyHash, body.password);
      if (!user || !ok) return reply.code(401).send({ error: "invalid_credentials" });

      const rows = await db
        .select({ studioId: memberships.studioId, role: memberships.role, status: memberships.status, slug: studios.slug })
        .from(memberships)
        .innerJoin(studios, eq(studios.id, memberships.studioId))
        .where(eq(memberships.userId, user.id));
      const candidates = body.studioSlug ? rows.filter((r) => r.slug === body.studioSlug) : rows;
      const active = candidates.filter((r) => r.status === "active");
      if (active.length === 0) {
        const pending = candidates.some((r) => r.status === "pending");
        return reply.code(403).send({ error: pending ? "pending_approval" : "no_access" });
      }
      if (active.length > 1) return reply.code(400).send({ error: "studio_required" });
      return startSession(reply, user, active[0]);
    });

    app.post("/auth/refresh", async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) return reply.code(401).send({ error: "unauthorized" });
      const tokenHash = hashRefreshToken(token);

      // Revoking is atomic, so a token can only ever be spent once.
      const [spent] = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
        .returning();
      if (!spent) {
        // Unknown token, or an already-used one being replayed: log that user out everywhere.
        const [known] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
        if (known) await revokeAll(known.userId);
        reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (spent.expiresAt <= new Date()) return reply.code(401).send({ error: "unauthorized" });

      const [row] = await db
        .select({ user: users, role: memberships.role, status: memberships.status })
        .from(users)
        .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.studioId, spent.studioId)))
        .where(eq(users.id, spent.userId));
      if (!row || row.status !== "active") return reply.code(401).send({ error: "unauthorized" });
      return startSession(reply, row.user, { studioId: spent.studioId, role: row.role });
    });

    app.post("/auth/logout", async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (token) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.tokenHash, hashRefreshToken(token)), isNull(refreshTokens.revokedAt)));
      }
      reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
      return reply.code(204).send();
    });

    app.get("/me", { preHandler: authenticate(config, { allowPasswordChange: true }) }, async (request, reply) => {
      const auth = request.auth!;
      const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        gender: user.gender,
        role: auth.role,
        studioId: auth.studioId,
        mustChangePassword: user.mustChangePassword,
      };
    });

    app.post(
      "/auth/change-password",
      { ...limited, preHandler: authenticate(config, { allowPasswordChange: true }) },
      async (request, reply) => {
        const auth = request.auth!;
        const body = changePasswordBody.parse(request.body);
        const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
        if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
          return reply.code(401).send({ error: "invalid_credentials" });
        }
        const [updated] = await db
          .update(users)
          .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false })
          .where(eq(users.id, user.id))
          .returning();
        // Every other device must log in again; this one gets a fresh session.
        await revokeAll(user.id);
        return startSession(reply, updated, { studioId: auth.studioId, role: auth.role });
      },
    );
  };
}
