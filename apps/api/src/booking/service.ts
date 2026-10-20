import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import { agreements, bookings, classSessions, classSlots, standingEnrollments, studios, students, users } from "../db/schema.js";
import { AppError } from "../errors.js";
import { dayRange, localDate, weekBounds } from "./time.js";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface StudioCtx {
  id: string;
  timezone: string;
  cancellationCutoffMinutes: number;
  bookingWindowDays: number;
}

// Bookings that use up a seat in the weekly limit. Cancelled ones do not.
const COUNTED = ["booked", "attended", "no_show"] as const;

export async function loadStudio(db: Db, studioId: string): Promise<StudioCtx> {
  const [studio] = await db.select().from(studios).where(eq(studios.id, studioId));
  if (!studio) throw new AppError(404, "studio_not_found");
  return {
    id: studio.id,
    timezone: studio.timezone,
    cancellationCutoffMinutes: studio.cancellationCutoffMinutes,
    bookingWindowDays: studio.bookingWindowDays,
  };
}

// Serializes everything a single student does, so two taps or two devices cannot both slip
// under the weekly limit. Always taken before any class row is touched.
export async function lockStudent(tx: Tx, studio: StudioCtx, studentId: string) {
  const [student] = await tx
    .select()
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.studioId, studio.id)))
    .for("update");
  if (!student) throw new AppError(404, "student_not_found");
  return student;
}

export async function activeWeeklyLimit(tx: Tx, studentId: string, onDate: string) {
  const [row] = await tx
    .select({ weeklyLimit: agreements.weeklyLimit })
    .from(agreements)
    .where(
      and(
        eq(agreements.studentId, studentId),
        lte(agreements.validFrom, onDate),
        or(isNull(agreements.validTo), sql`${agreements.validTo} >= ${onDate}`),
      ),
    )
    .orderBy(sql`${agreements.validFrom} desc`)
    .limit(1);
  return row?.weeklyLimit ?? null;
}

export async function countInWeek(tx: Tx, studentId: string, weekStart: Date, weekEnd: Date) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(
      and(
        eq(bookings.studentId, studentId),
        inArray(bookings.status, [...COUNTED]),
        gte(classSessions.startsAt, weekStart),
        lt(classSessions.startsAt, weekEnd),
      ),
    );
  return row.count;
}

async function assertWithinWeeklyLimit(tx: Tx, studio: StudioCtx, studentId: string, startsAt: Date) {
  const limit = await activeWeeklyLimit(tx, studentId, localDate(startsAt, studio.timezone));
  if (limit === null) throw new AppError(403, "no_agreement");
  const week = weekBounds(startsAt, studio.timezone);
  const used = await countInWeek(tx, studentId, week.start, week.end);
  if (used + 1 > limit) throw new AppError(409, "weekly_limit_reached");
}

async function loadBookableSession(tx: Tx, studio: StudioCtx, sessionId: string) {
  const [session] = await tx
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.id, sessionId), eq(classSessions.studioId, studio.id)));
  if (!session) throw new AppError(404, "session_not_found");
  if (session.status !== "scheduled") throw new AppError(409, "session_cancelled");
  const now = Date.now();
  if (session.startsAt.getTime() <= now) throw new AppError(409, "class_started");
  const limit = DateTime.now().plus({ days: studio.bookingWindowDays }).toMillis();
  if (session.startsAt.getTime() > limit) throw new AppError(409, "outside_booking_window");
  return session;
}

// Takes one seat only if one is free. The single UPDATE is the whole capacity check, so two
// requests for the last seat can never both succeed.
async function claimSeat(tx: Tx, studioId: string, sessionId: string) {
  const claimed = await tx
    .update(classSessions)
    .set({ bookedCount: sql`${classSessions.bookedCount} + 1` })
    .where(
      and(
        eq(classSessions.id, sessionId),
        eq(classSessions.studioId, studioId),
        eq(classSessions.status, "scheduled"),
        lt(classSessions.bookedCount, classSessions.capacity),
      ),
    )
    .returning({ id: classSessions.id });
  if (claimed.length === 0) {
    const [session] = await tx.select({ status: classSessions.status }).from(classSessions).where(eq(classSessions.id, sessionId));
    throw new AppError(409, session?.status === "cancelled" ? "session_cancelled" : "class_full");
  }
}

// For a fixed student whose staff accepted a full class: when no seat is free, the class grows by one.
async function claimSeatOrOverbook(tx: Tx, studioId: string, sessionId: string): Promise<boolean> {
  try {
    await claimSeat(tx, studioId, sessionId);
    return false;
  } catch (err) {
    if (!(err instanceof AppError && err.code === "class_full")) throw err;
  }
  const grown = await tx
    .update(classSessions)
    .set({ capacity: sql`${classSessions.capacity} + 1`, bookedCount: sql`${classSessions.bookedCount} + 1` })
    .where(and(eq(classSessions.id, sessionId), eq(classSessions.studioId, studioId), eq(classSessions.status, "scheduled")))
    .returning({ id: classSessions.id });
  if (grown.length === 0) throw new AppError(409, "session_cancelled");
  return true;
}

async function releaseSeat(tx: Tx, sessionId: string) {
  await tx
    .update(classSessions)
    .set({ bookedCount: sql`greatest(${classSessions.bookedCount} - 1, 0)` })
    .where(eq(classSessions.id, sessionId));
}

async function findByIdempotencyKey(tx: Tx, studentId: string, key: string | undefined) {
  if (!key) return null;
  const [existing] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.studentId, studentId), eq(bookings.idempotencyKey, key)));
  return existing ?? null;
}

async function assertNotBooked(tx: Tx, sessionId: string, studentId: string) {
  const [duplicate] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.studentId, studentId), eq(bookings.status, "booked")));
  if (duplicate) throw new AppError(409, "already_booked");
}

// The partial unique index on (session, student) is the final guard if two requests race here.
async function insertBooking(
  tx: Tx,
  studio: StudioCtx,
  values: {
    sessionId: string;
    studentId: string;
    source: "standing" | "one_off";
    replacesBookingId?: string;
    idempotencyKey?: string;
    createdBy?: string;
  },
) {
  const [booking] = await tx.insert(bookings).values({ studioId: studio.id, ...values }).returning();
  return booking;
}

export async function bookSeat(
  db: Db,
  studio: StudioCtx,
  input: { studentId: string; sessionId: string; idempotencyKey?: string; createdBy?: string },
) {
  return db.transaction(async (tx) => {
    await lockStudent(tx, studio, input.studentId);
    const repeated = await findByIdempotencyKey(tx, input.studentId, input.idempotencyKey);
    if (repeated) return { booking: repeated, replayed: true };

    const session = await loadBookableSession(tx, studio, input.sessionId);
    await assertNotBooked(tx, session.id, input.studentId);
    await assertWithinWeeklyLimit(tx, studio, input.studentId, session.startsAt);
    await claimSeat(tx, studio.id, session.id);
    const booking = await insertBooking(tx, studio, {
      sessionId: session.id,
      studentId: input.studentId,
      source: "one_off",
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
    });
    return { booking, replayed: false };
  });
}

export async function cancelBooking(
  db: Db,
  studio: StudioCtx,
  input: { bookingId: string; actor: { userId: string; role: "owner" | "staff" | "student" } },
) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ booking: bookings, userId: students.userId })
      .from(bookings)
      .innerJoin(students, eq(students.id, bookings.studentId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.studioId, studio.id)));
    // Students only ever see their own bookings.
    if (!found || (input.actor.role === "student" && found.userId !== input.actor.userId)) {
      throw new AppError(404, "booking_not_found");
    }
    await lockStudent(tx, studio, found.booking.studentId);

    // Lock order everywhere is student, then class row, then booking rows. Cancelling a whole class
    // takes the class row first, so taking the booking row first here could deadlock with it.
    const [session] = await tx.select().from(classSessions).where(eq(classSessions.id, found.booking.sessionId)).for("update");
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, found.booking.id)).for("update");
    if (booking.status !== "booked") throw new AppError(409, "booking_not_active");
    if (input.actor.role === "student") {
      const cutoff = session.startsAt.getTime() - studio.cancellationCutoffMinutes * 60_000;
      if (Date.now() >= cutoff) throw new AppError(409, "too_late_to_cancel");
    }
    const cancelReason = input.actor.role === "student" ? "student" : "staff";
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason })
      .where(eq(bookings.id, booking.id));
    await releaseSeat(tx, session.id);
    return { ...booking, status: "cancelled" as const };
  });
}

// One-off swap: give up the original seat and take another, all or nothing. If the new class
// is full or over the limit, the student keeps the original.
export async function swapBooking(
  db: Db,
  studio: StudioCtx,
  input: { studentId: string; fromBookingId: string; toSessionId: string; idempotencyKey?: string; createdBy?: string },
) {
  return db.transaction(async (tx) => {
    await lockStudent(tx, studio, input.studentId);
    const repeated = await findByIdempotencyKey(tx, input.studentId, input.idempotencyKey);
    if (repeated) return { booking: repeated, replayed: true };

    const [from] = await tx
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, input.fromBookingId), eq(bookings.studioId, studio.id), eq(bookings.studentId, input.studentId)),
      );
    if (!from) throw new AppError(404, "booking_not_found");
    if (from.status !== "booked") throw new AppError(409, "booking_not_active");
    if (from.sessionId === input.toSessionId) throw new AppError(400, "same_session");

    const target = await loadBookableSession(tx, studio, input.toSessionId);
    // Both class rows are locked in id order, so two opposite swaps cannot deadlock.
    await tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(inArray(classSessions.id, [from.sessionId, target.id]))
      .orderBy(classSessions.id)
      .for("update");
    const [lockedFrom] = await tx.select().from(bookings).where(eq(bookings.id, from.id)).for("update");
    if (lockedFrom.status !== "booked") throw new AppError(409, "booking_not_active");

    const [oldSession] = await tx.select().from(classSessions).where(eq(classSessions.id, from.sessionId));
    const cutoff = oldSession.startsAt.getTime() - studio.cancellationCutoffMinutes * 60_000;
    if (Date.now() >= cutoff) throw new AppError(409, "too_late_to_cancel");

    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "swap" })
      .where(eq(bookings.id, from.id));
    await releaseSeat(tx, oldSession.id);

    await assertNotBooked(tx, target.id, input.studentId);
    await assertWithinWeeklyLimit(tx, studio, input.studentId, target.startsAt);
    await claimSeat(tx, studio.id, target.id);
    const booking = await insertBooking(tx, studio, {
      sessionId: target.id,
      studentId: input.studentId,
      source: "one_off",
      replacesBookingId: from.id,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
    });
    return { booking, replayed: false };
  });
}

export interface GenerationResult {
  sessionsCreated: number;
  standingBooked: number;
  standingOverbooked: number;
  standingSkipped: { studentId: string; sessionId: string; reason: string }[];
}

// Creates class sessions for the coming days from the weekly timetable, then books the fixed
// schedule into them. Safe to run repeatedly: existing sessions and bookings are left alone,
// and a standing booking a student cancelled (an absence) is not recreated.
export async function generateSessions(db: Db, studio: StudioCtx, days = studio.bookingWindowDays): Promise<GenerationResult> {
  const now = DateTime.now().setZone(studio.timezone);
  const slots = await db.select().from(classSlots).where(eq(classSlots.studioId, studio.id));

  const wanted: { slotId: string; startsAt: Date; capacity: number }[] = [];
  for (let i = 0; i <= days; i++) {
    const day = now.startOf("day").plus({ days: i });
    for (const slot of slots) {
      if (slot.weekday !== day.weekday) continue;
      const date = day.toISODate()!;
      if (slot.activeFrom > date || (slot.activeTo && slot.activeTo < date)) continue;
      const startsAt = DateTime.fromISO(`${date}T${slot.startTime}`, { zone: studio.timezone });
      if (!startsAt.isValid || startsAt <= now) continue;
      wanted.push({ slotId: slot.id, startsAt: startsAt.toUTC().toJSDate(), capacity: slot.capacity });
    }
  }

  let sessionsCreated = 0;
  if (wanted.length > 0) {
    const inserted = await db
      .insert(classSessions)
      .values(wanted.map((w) => ({ studioId: studio.id, ...w })))
      .onConflictDoNothing({ target: [classSessions.slotId, classSessions.startsAt] })
      .returning({ id: classSessions.id });
    sessionsCreated = inserted.length;
  }

  const result: GenerationResult = { sessionsCreated, standingBooked: 0, standingOverbooked: 0, standingSkipped: [] };
  const horizon = now.plus({ days: days + 1 }).startOf("day").toJSDate();
  const sessions = await db
    .select()
    .from(classSessions)
    .where(
      and(
        eq(classSessions.studioId, studio.id),
        eq(classSessions.status, "scheduled"),
        gte(classSessions.startsAt, now.toJSDate()),
        lt(classSessions.startsAt, horizon),
      ),
    );
  if (sessions.length === 0) return result;

  const enrollments = await db.select().from(standingEnrollments).where(eq(standingEnrollments.studioId, studio.id));
  const already = await db
    .select({
      sessionId: bookings.sessionId,
      studentId: bookings.studentId,
      status: bookings.status,
      cancelReason: bookings.cancelReason,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.studioId, studio.id),
        eq(bookings.source, "standing"),
        inArray(
          bookings.sessionId,
          sessions.map((s) => s.id),
        ),
      ),
    );
  // Skip pairs that are booked or were deliberately cancelled; re-book ones cancelled only because an enrollment ended.
  const done = new Set(
    already
      .filter((b) => b.status !== "cancelled" || b.cancelReason !== "enrollment_ended")
      .map((b) => `${b.sessionId}|${b.studentId}`),
  );

  for (const session of sessions) {
    const date = localDate(session.startsAt, studio.timezone);
    for (const enrollment of enrollments) {
      if (enrollment.slotId !== session.slotId) continue;
      if (enrollment.validFrom > date || (enrollment.validTo && enrollment.validTo < date)) continue;
      if (done.has(`${session.id}|${enrollment.studentId}`)) continue;
      try {
        const overbooked = await db.transaction(async (tx) => {
          const student = await lockStudent(tx, studio, enrollment.studentId);
          if (student.status !== "active") throw new AppError(409, "student_inactive");
          await assertNotBooked(tx, session.id, enrollment.studentId);
          await assertWithinWeeklyLimit(tx, studio, enrollment.studentId, session.startsAt);
          const grew = enrollment.allowOverCapacity
            ? await claimSeatOrOverbook(tx, studio.id, session.id)
            : (await claimSeat(tx, studio.id, session.id), false);
          await insertBooking(tx, studio, { sessionId: session.id, studentId: enrollment.studentId, source: "standing" });
          return grew;
        });
        result.standingBooked++;
        if (overbooked) result.standingOverbooked++;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        result.standingSkipped.push({ studentId: enrollment.studentId, sessionId: session.id, reason: err.code });
      }
    }
  }
  return result;
}

// Ends a fixed-schedule enrollment from a date and cancels the standing bookings after it.
// A permanent change of time slot is this plus a new enrollment.
export async function endEnrollment(db: Db, studio: StudioCtx, enrollmentId: string, effectiveFrom: string) {
  const [enrollment] = await db
    .select()
    .from(standingEnrollments)
    .where(and(eq(standingEnrollments.id, enrollmentId), eq(standingEnrollments.studioId, studio.id)));
  if (!enrollment) throw new AppError(404, "enrollment_not_found");

  return db.transaction(async (tx) => {
    await lockStudent(tx, studio, enrollment.studentId);
    const lastDay = DateTime.fromISO(effectiveFrom).minus({ days: 1 }).toISODate()!;
    // Ended on or before its first day: it never ran, so it becomes an empty range in the past. It is kept
    // rather than deleted because a request may point to it.
    await tx
      .update(standingEnrollments)
      .set({ validFrom: enrollment.validFrom > lastDay ? lastDay : enrollment.validFrom, validTo: lastDay })
      .where(eq(standingEnrollments.id, enrollment.id));

    // Classes that already started stay as they were; everything still to come from that day on is cancelled now.
    const dayStart = DateTime.fromISO(effectiveFrom, { zone: studio.timezone }).startOf("day").toJSDate();
    const from = new Date(Math.max(dayStart.getTime(), Date.now()));
    const candidates = await tx
      .select({ id: bookings.id, sessionId: bookings.sessionId })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(
        and(
          eq(bookings.studentId, enrollment.studentId),
          eq(bookings.source, "standing"),
          eq(bookings.status, "booked"),
          eq(classSessions.slotId, enrollment.slotId),
          gte(classSessions.startsAt, from),
        ),
      );
    if (candidates.length === 0) return { bookingsCancelled: 0 };

    // Class rows first (in id order), then the booking rows, as everywhere else.
    await tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(inArray(classSessions.id, [...new Set(candidates.map((c) => c.sessionId))]))
      .orderBy(classSessions.id)
      .for("update");
    const affected = await tx
      .select({ id: bookings.id, sessionId: bookings.sessionId })
      .from(bookings)
      .where(and(inArray(bookings.id, candidates.map((c) => c.id)), eq(bookings.status, "booked")))
      .for("update");
    for (const row of affected) {
      await tx
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "enrollment_ended" })
        .where(eq(bookings.id, row.id));
      await releaseSeat(tx, row.sessionId);
    }
    return { bookingsCancelled: affected.length };
  });
}

export interface CancelledClass {
  sessionId: string;
  startsAt: Date;
  bookingsCancelled: number;
  affected: { studentId: string; name: string; phone: string | null }[];
}

// Cancels a class (holiday, instructor out). Every active booking in it is cancelled and no longer
// counts toward the student's weekly limit, so they can book another class that week. Staff get the
// list of affected students to tell them; there are no notifications yet.
export async function cancelSession(db: Db, studio: StudioCtx, sessionId: string, note?: string): Promise<CancelledClass> {
  return db.transaction(async (tx) => {
    // Taking the class row first stops new bookings (they fail with session_cancelled) and waits for
    // any booking in progress, so the bookings read below are complete.
    const [session] = await tx
      .update(classSessions)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelNote: note ?? null })
      .where(and(eq(classSessions.id, sessionId), eq(classSessions.studioId, studio.id), eq(classSessions.status, "scheduled")))
      .returning();
    if (!session) {
      const [existing] = await tx
        .select({ status: classSessions.status })
        .from(classSessions)
        .where(and(eq(classSessions.id, sessionId), eq(classSessions.studioId, studio.id)));
      throw existing ? new AppError(409, "session_already_cancelled") : new AppError(404, "session_not_found");
    }

    const cancelled = await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "class_cancelled" })
      .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "booked")))
      .returning({ studentId: bookings.studentId });
    // Attended and no-show bookings keep their seat, so only the cancelled ones are released.
    await tx
      .update(classSessions)
      .set({ bookedCount: sql`greatest(${classSessions.bookedCount} - ${cancelled.length}, 0)` })
      .where(eq(classSessions.id, sessionId));

    const affected = cancelled.length
      ? await tx
          .select({ studentId: students.id, name: users.name, phone: users.phone })
          .from(students)
          .innerJoin(users, eq(users.id, students.userId))
          .where(inArray(students.id, cancelled.map((c) => c.studentId)))
          .orderBy(users.name)
      : [];
    return { sessionId, startsAt: session.startsAt, bookingsCancelled: cancelled.length, affected };
  });
}

// Cancels every class that is still scheduled on a calendar day in the studio's time zone (a holiday).
export async function cancelDay(db: Db, studio: StudioCtx, date: string, note?: string) {
  const { start, end, valid } = dayRange(date, date, studio.timezone);
  if (!valid) throw new AppError(400, "invalid_date");
  const sessions = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.studioId, studio.id),
        eq(classSessions.status, "scheduled"),
        gte(classSessions.startsAt, start),
        lt(classSessions.startsAt, end),
      ),
    )
    .orderBy(classSessions.startsAt);
  const classes: CancelledClass[] = [];
  for (const { id } of sessions) {
    try {
      classes.push(await cancelSession(db, studio, id, note));
    } catch (err) {
      // Someone else cancelled it in the meantime: nothing left to do for that class.
      if (!(err instanceof AppError && err.code === "session_already_cancelled")) throw err;
    }
  }
  return { classesCancelled: classes.length, bookingsCancelled: classes.reduce((n, c) => n + c.bookingsCancelled, 0), classes };
}
