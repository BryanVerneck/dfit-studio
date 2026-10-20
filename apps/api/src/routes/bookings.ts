import { and, eq, gte, inArray, lt, ne, or } from "drizzle-orm";
import { DateTime } from "luxon";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/guard.js";
import type { AccessClaims } from "../auth/tokens.js";
import { activeWeeklyLimit, bookSeat, cancelBooking, countInWeek, loadStudio, swapBooking } from "../booking/service.js";
import { dayRange, localDate, weekBounds } from "../booking/time.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { bookings, classSessions, classSlots, students } from "../db/schema.js";
import { AppError } from "../errors.js";

const NO_STUDENT = "00000000-0000-0000-0000-000000000000";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: z.string().uuid() });
const range = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const idempotencyKey = z.string().min(1).max(100).optional();

export async function currentStudent(db: Db, auth: AccessClaims) {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.studioId, auth.studioId), eq(students.userId, auth.userId)));
  if (!student) throw new AppError(403, "not_a_student");
  if (student.status !== "active") throw new AppError(403, "student_inactive");
  return student;
}

const bookingView = (b: { id: string; sessionId: string; studentId: string; source: string; status: string }) => ({
  id: b.id,
  sessionId: b.sessionId,
  studentId: b.studentId,
  source: b.source,
  status: b.status,
});

export function bookingRoutes(config: Config, db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", authenticate(config));
    const studentOnly = requireRole("student");

    // The class schedule with open spots. Students also see which classes they hold a seat in.
    app.get("/sessions", async (request) => {
      const auth = request.auth!;
      const studio = await loadStudio(db, auth.studioId);
      const query = range.parse(request.query);
      const today = localDate(new Date(), studio.timezone);
      const from = query.from ?? today;
      const to = query.to ?? DateTime.fromISO(from).plus({ days: 6 }).toISODate()!;
      const { start, end, valid } = dayRange(from, to, studio.timezone);
      if (!valid || end <= start || end.getTime() - start.getTime() > 35 * 86_400_000) {
        throw new AppError(400, "invalid_range");
      }
      const studentId = auth.role === "student" ? (await currentStudent(db, auth)).id : NO_STUDENT;

      const rows = await db
        .select({
          id: classSessions.id,
          slotId: classSessions.slotId,
          name: classSlots.name,
          startsAt: classSessions.startsAt,
          durationMin: classSlots.durationMin,
          capacity: classSessions.capacity,
          bookedCount: classSessions.bookedCount,
          status: classSessions.status,
          cancelNote: classSessions.cancelNote,
          myBookingId: bookings.id,
          myBookingSource: bookings.source,
        })
        .from(classSessions)
        .innerJoin(classSlots, eq(classSlots.id, classSessions.slotId))
        .leftJoin(
          bookings,
          and(eq(bookings.sessionId, classSessions.id), eq(bookings.studentId, studentId), eq(bookings.status, "booked")),
        )
        .where(
          and(
            eq(classSessions.studioId, studio.id),
            // Students never see cancelled classes; staff do, so they know what was called off.
            auth.role === "student" ? ne(classSessions.status, "cancelled") : undefined,
            gte(classSessions.startsAt, start),
            lt(classSessions.startsAt, end),
          ),
        )
        .orderBy(classSessions.startsAt);
      return rows.map(({ bookedCount, myBookingId, ...r }) => ({
          ...r,
          spotsLeft: Math.max(r.capacity - bookedCount, 0),
          myBookingId,
        }));
    });

    app.post("/bookings", { preHandler: studentOnly }, async (request, reply) => {
      const auth = request.auth!;
      const body = z.object({ sessionId: z.string().uuid(), idempotencyKey }).parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      const { booking, replayed } = await bookSeat(db, studio, {
        studentId: student.id,
        sessionId: body.sessionId,
        idempotencyKey: body.idempotencyKey ?? headerKey(request.headers["idempotency-key"]),
        createdBy: auth.userId,
      });
      return reply.code(replayed ? 200 : 201).send({ booking: bookingView(booking) });
    });

    // Students cancel their own booking (any time until the class starts); staff can cancel any booking.
    app.delete("/bookings/:id", async (request) => {
      const auth = request.auth!;
      const { id } = idParams.parse(request.params);
      const studio = await loadStudio(db, auth.studioId);
      const booking = await cancelBooking(db, studio, { bookingId: id, actor: { userId: auth.userId, role: auth.role } });
      return { booking: bookingView(booking) };
    });

    app.post("/bookings/:id/swap", { preHandler: studentOnly }, async (request, reply) => {
      const auth = request.auth!;
      const { id } = idParams.parse(request.params);
      const body = z.object({ toSessionId: z.string().uuid(), idempotencyKey }).parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      const { booking, replayed } = await swapBooking(db, studio, {
        studentId: student.id,
        fromBookingId: id,
        toSessionId: body.toSessionId,
        idempotencyKey: body.idempotencyKey ?? headerKey(request.headers["idempotency-key"]),
        createdBy: auth.userId,
      });
      return reply.code(replayed ? 200 : 201).send({ booking: bookingView(booking) });
    });

    app.get("/me/bookings", { preHandler: studentOnly }, async (request) => {
      const auth = request.auth!;
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      const query = range.parse(request.query);
      const from = query.from ?? localDate(new Date(), studio.timezone);
      const to = query.to ?? DateTime.fromISO(from).plus({ days: 28 }).toISODate()!;
      const { start, end, valid } = dayRange(from, to, studio.timezone);
      if (!valid || end <= start) throw new AppError(400, "invalid_range");
      const rows = await db
        .select({
          id: bookings.id,
          sessionId: bookings.sessionId,
          source: bookings.source,
          status: bookings.status,
          replacesBookingId: bookings.replacesBookingId,
          cancelReason: bookings.cancelReason,
          cancelNote: classSessions.cancelNote,
          name: classSlots.name,
          startsAt: classSessions.startsAt,
          durationMin: classSlots.durationMin,
        })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .innerJoin(classSlots, eq(classSlots.id, classSessions.slotId))
        .where(
          and(
            eq(bookings.studentId, student.id),
            // Bookings in a class that was called off stay visible, so the student knows why it vanished.
            or(inArray(bookings.status, ["booked", "attended", "no_show"]), eq(bookings.cancelReason, "class_cancelled")),
            gte(classSessions.startsAt, start),
            lt(classSessions.startsAt, end),
          ),
        )
        .orderBy(classSessions.startsAt);
      return rows;
    });

    // How many classes the student has used in the booking week containing `date`.
    app.get("/me/weekly-usage", { preHandler: studentOnly }, async (request) => {
      const auth = request.auth!;
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      const { date } = z.object({ date: isoDate.optional() }).parse(request.query);
      const day = date ?? localDate(new Date(), studio.timezone);
      const instant = DateTime.fromISO(day, { zone: studio.timezone }).toJSDate();
      const week = weekBounds(instant, studio.timezone);
      const { used, weeklyLimit } = await db.transaction(async (tx) => ({
        used: await countInWeek(tx, student.id, week.start, week.end),
        weeklyLimit: await activeWeeklyLimit(tx, student.id, day),
      }));
      return {
        weekStart: week.startDate,
        used,
        weeklyLimit,
        remaining: weeklyLimit === null ? null : Math.max(weeklyLimit - used, 0),
      };
    });
  };
}

function headerKey(value: string | string[] | undefined) {
  const key = Array.isArray(value) ? value[0] : value;
  return key && key.length <= 100 ? key : undefined;
}
