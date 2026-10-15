import { and, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/guard.js";
import { bookSeat, endEnrollment, generateSessions, loadStudio } from "../booking/service.js";
import { localDate } from "../booking/time.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { agreements, bookings, classSessions, classSlots, standingEnrollments, studios, students, users } from "../db/schema.js";
import { AppError } from "../errors.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

const slotBody = z.object({
  name: z.string().trim().min(1).max(80),
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().int().min(5).max(480),
  capacity: z.number().int().min(1).max(500),
  activeFrom: isoDate.optional(),
});

export function scheduleRoutes(config: Config, db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", authenticate(config));
    app.addHook("preHandler", requireRole("owner", "staff"));

    // The weekly timetable. Each studio decides how many classes it runs each day.
    app.post("/staff/slots", async (request, reply) => {
      const auth = request.auth!;
      const body = slotBody.parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const [settings] = await db.select({ days: studios.bookingWeekDays }).from(studios).where(eq(studios.id, studio.id));
      if (!settings.days.includes(body.weekday)) throw new AppError(400, "weekday_not_in_booking_week");
      const [slot] = await db
        .insert(classSlots)
        .values({ ...body, studioId: studio.id, activeFrom: body.activeFrom ?? localDate(new Date(), studio.timezone) })
        .returning();
      return reply.code(201).send({ slot });
    });

    app.get("/staff/slots", async (request) => {
      const { studioId } = request.auth!;
      return db
        .select()
        .from(classSlots)
        .where(eq(classSlots.studioId, studioId))
        .orderBy(classSlots.weekday, classSlots.startTime);
    });

    // Creates sessions for the coming days and books the fixed schedule into them.
    app.post("/staff/sessions/generate", async (request) => {
      const body = z.object({ days: z.number().int().min(1).max(90).optional() }).parse(request.body ?? {});
      const studio = await loadStudio(db, request.auth!.studioId);
      return generateSessions(db, studio, body.days);
    });

    app.get("/staff/sessions/:id/roster", async (request) => {
      const { studioId } = request.auth!;
      const { id } = z.object({ id: uuid }).parse(request.params);
      const [session] = await db
        .select({
          id: classSessions.id,
          name: classSlots.name,
          startsAt: classSessions.startsAt,
          capacity: classSessions.capacity,
          bookedCount: classSessions.bookedCount,
          status: classSessions.status,
        })
        .from(classSessions)
        .innerJoin(classSlots, eq(classSlots.id, classSessions.slotId))
        .where(and(eq(classSessions.id, id), eq(classSessions.studioId, studioId)));
      if (!session) throw new AppError(404, "session_not_found");
      const roster = await db
        .select({
          bookingId: bookings.id,
          studentId: students.id,
          name: users.name,
          phone: users.phone,
          source: bookings.source,
        })
        .from(bookings)
        .innerJoin(students, eq(students.id, bookings.studentId))
        .innerJoin(users, eq(users.id, students.userId))
        .where(and(eq(bookings.sessionId, id), eq(bookings.status, "booked")))
        .orderBy(users.name);
      return { session, roster };
    });

    // Staff can book a student into a class (for example after a call to the studio).
    app.post("/staff/bookings", async (request, reply) => {
      const auth = request.auth!;
      const body = z.object({ studentId: uuid, sessionId: uuid }).parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const { booking } = await bookSeat(db, studio, { ...body, createdBy: auth.userId });
      return reply.code(201).send({ booking: { id: booking.id, sessionId: booking.sessionId, status: booking.status } });
    });

    // Sets a student's weekly class limit from a date. History is kept: the previous agreement
    // is closed the day before, and a change on the same day just edits that day's row.
    app.post("/staff/students/:studentId/agreement", async (request) => {
      const auth = request.auth!;
      const { studentId } = z.object({ studentId: uuid }).parse(request.params);
      const body = z.object({ weeklyLimit: z.number().int().min(0).max(14), validFrom: isoDate.optional(), notes: z.string().max(500).optional() }).parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const validFrom = body.validFrom ?? localDate(new Date(), studio.timezone);

      return db.transaction(async (tx) => {
        const [student] = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.id, studentId), eq(students.studioId, studio.id)))
          .for("update");
        if (!student) throw new AppError(404, "student_not_found");

        const [latest] = await tx
          .select()
          .from(agreements)
          .where(eq(agreements.studentId, studentId))
          .orderBy(sql`${agreements.validFrom} desc`)
          .limit(1);
        if (latest && latest.validFrom > validFrom) throw new AppError(400, "starts_before_current_agreement");
        if (latest && latest.validFrom === validFrom) {
          const [updated] = await tx
            .update(agreements)
            .set({ weeklyLimit: body.weeklyLimit, notes: body.notes ?? latest.notes })
            .where(eq(agreements.id, latest.id))
            .returning();
          return { agreement: updated };
        }
        if (latest && (latest.validTo === null || latest.validTo >= validFrom)) {
          const dayBefore = DateTime.fromISO(validFrom).minus({ days: 1 }).toISODate()!;
          await tx.update(agreements).set({ validTo: dayBefore }).where(eq(agreements.id, latest.id));
        }
        const [agreement] = await tx
          .insert(agreements)
          .values({ studioId: studio.id, studentId, weeklyLimit: body.weeklyLimit, validFrom, notes: body.notes })
          .returning();
        return { agreement };
      });
    });

    // The fixed weekly schedule. Creating one also books the student into the coming sessions.
    app.post("/staff/students/:studentId/standing-enrollments", async (request, reply) => {
      const auth = request.auth!;
      const { studentId } = z.object({ studentId: uuid }).parse(request.params);
      const body = z.object({ slotId: uuid, validFrom: isoDate.optional() }).parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const validFrom = body.validFrom ?? localDate(new Date(), studio.timezone);

      const [student] = await db
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, studentId), eq(students.studioId, studio.id)));
      if (!student) throw new AppError(404, "student_not_found");
      const [slot] = await db
        .select({ id: classSlots.id })
        .from(classSlots)
        .where(and(eq(classSlots.id, body.slotId), eq(classSlots.studioId, studio.id)));
      if (!slot) throw new AppError(404, "slot_not_found");
      const [open] = await db
        .select({ id: standingEnrollments.id })
        .from(standingEnrollments)
        .where(
          and(
            eq(standingEnrollments.studentId, studentId),
            eq(standingEnrollments.slotId, body.slotId),
            sql`(${standingEnrollments.validTo} is null or ${standingEnrollments.validTo} >= ${validFrom})`,
          ),
        );
      if (open) throw new AppError(409, "already_enrolled");

      const [enrollment] = await db
        .insert(standingEnrollments)
        .values({ studioId: studio.id, studentId, slotId: body.slotId, validFrom })
        .returning();
      const generated = await generateSessions(db, studio);
      return reply.code(201).send({ enrollment, generated });
    });

    // Ends a fixed enrollment from a date (default today) and cancels its standing bookings from then on.
    app.post("/staff/standing-enrollments/:id/end", async (request) => {
      const auth = request.auth!;
      const { id } = z.object({ id: uuid }).parse(request.params);
      const body = z.object({ effectiveFrom: isoDate.optional() }).parse(request.body ?? {});
      const studio = await loadStudio(db, auth.studioId);
      return endEnrollment(db, studio, id, body.effectiveFrom ?? localDate(new Date(), studio.timezone));
    });
  };
}
