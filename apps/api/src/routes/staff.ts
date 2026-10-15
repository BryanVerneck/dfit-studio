import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/guard.js";
import { generateTemporaryPassword, hashPassword } from "../auth/password.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { localDate } from "../booking/time.js";
import { loadStudio } from "../booking/service.js";
import { agreements, memberships, refreshTokens, students, users } from "../db/schema.js";

const params = z.object({ userId: z.string().uuid() });

export function staffRoutes(config: Config, db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", authenticate(config));
    app.addHook("preHandler", requireRole("owner", "staff"));

    app.get("/staff/pending-students", async (request) => {
      const { studioId } = request.auth!;
      return db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          requestedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.studioId, studioId), eq(memberships.status, "pending"), eq(memberships.role, "student")))
        .orderBy(memberships.createdAt);
    });

    // Active students with the weekly limit that applies today (null when no agreement covers today).
    app.get("/staff/students", async (request) => {
      const { studioId } = request.auth!;
      const studio = await loadStudio(db, studioId);
      const today = localDate(new Date(), studio.timezone);
      const rows = await db
        .select({ studentId: students.id, userId: users.id, name: users.name, email: users.email, phone: users.phone })
        .from(students)
        .innerJoin(users, eq(users.id, students.userId))
        .where(and(eq(students.studioId, studioId), eq(students.status, "active")))
        .orderBy(users.name);
      const current = rows.length
        ? await db
            .select({ studentId: agreements.studentId, weeklyLimit: agreements.weeklyLimit })
            .from(agreements)
            .where(
              and(
                inArray(agreements.studentId, rows.map((r) => r.studentId)),
                sql`${agreements.validFrom} <= ${today}`,
                sql`(${agreements.validTo} is null or ${agreements.validTo} >= ${today})`,
              ),
            )
        : [];
      const limits = new Map(current.map((a) => [a.studentId, a.weeklyLimit]));
      return rows.map((r) => ({ ...r, weeklyLimit: limits.get(r.studentId) ?? null }));
    });

    app.post("/staff/students/:userId/approve", async (request, reply) => {
      const { studioId } = request.auth!;
      const { userId } = params.parse(request.params);
      const result = await db.transaction(async (tx) => {
        const [approved] = await tx
          .update(memberships)
          .set({ status: "active" })
          .where(
            and(
              eq(memberships.studioId, studioId),
              eq(memberships.userId, userId),
              eq(memberships.role, "student"),
              eq(memberships.status, "pending"),
            ),
          )
          .returning({ userId: memberships.userId });
        if (!approved) return null;
        await tx.insert(students).values({ studioId, userId }).onConflictDoNothing();
        const [student] = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.studioId, studioId), eq(students.userId, userId)));
        return student;
      });
      if (!result) return reply.code(404).send({ error: "pending_student_not_found" });
      return { studentId: result.id };
    });

    // Staff can reset students; only an owner can reset staff or other owners.
    app.post("/staff/users/:userId/temporary-password", async (request, reply) => {
      const auth = request.auth!;
      const { userId } = params.parse(request.params);
      const [target] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.studioId, auth.studioId), eq(memberships.userId, userId)));
      if (!target) return reply.code(404).send({ error: "user_not_found" });
      if (target.role !== "student" && auth.role !== "owner") return reply.code(403).send({ error: "forbidden" });

      const temporaryPassword = generateTemporaryPassword();
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true })
        .where(eq(users.id, userId));
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      // Shown once: staff pass it to the student, who must replace it at next login.
      return { temporaryPassword };
    });
  };
}
