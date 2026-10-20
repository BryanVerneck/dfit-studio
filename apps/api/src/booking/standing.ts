import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db } from "../db/client.js";
import { classSessions, classSlots, standingEnrollments, standingRequests, students, users } from "../db/schema.js";
import { AppError } from "../errors.js";
import { activeWeeklyLimit, endEnrollment, generateSessions, lockStudent, type StudioCtx, type Tx } from "./service.js";
import { localDate } from "./time.js";

export interface SlotInfo {
  slotId: string;
  enrollmentId: string | null;
  name: string;
  weekday: number;
  startTime: string;
  durationMin: number;
}

export interface CapacityPreview {
  capacity: number;
  nextBooked: number;
  fullSessions: number;
  totalSessions: number;
}

const today = (studio: StudioCtx) => localDate(new Date(), studio.timezone);

const openEnrollment = (onDate: string) =>
  or(isNull(standingEnrollments.validTo), sql`${standingEnrollments.validTo} >= ${onDate}`);

// A fixed class counts against the weekly limit: a student cannot hold more fixed classes than classes per week.
// Raise the limit first if more are needed.
async function assertRoomForFixed(tx: Tx, studentId: string, onDate: string) {
  const limit = await activeWeeklyLimit(tx, studentId, onDate);
  if (limit === null) throw new AppError(403, "no_agreement");
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(standingEnrollments)
    .where(and(eq(standingEnrollments.studentId, studentId), openEnrollment(onDate)));
  if (row.count + 1 > limit) throw new AppError(409, "fixed_limit_reached");
}

async function assertCanJoinSlot(tx: Tx, studio: StudioCtx, studentId: string, slotId: string, onDate: string, ignoring?: string) {
  const [slot] = await tx
    .select({ id: classSlots.id, activeTo: classSlots.activeTo })
    .from(classSlots)
    .where(and(eq(classSlots.id, slotId), eq(classSlots.studioId, studio.id)));
  if (!slot || (slot.activeTo && slot.activeTo < onDate)) throw new AppError(404, "slot_not_found");
  const open = await tx
    .select({ id: standingEnrollments.id })
    .from(standingEnrollments)
    .where(and(eq(standingEnrollments.studentId, studentId), eq(standingEnrollments.slotId, slotId), openEnrollment(onDate)));
  if (open.some((e) => e.id !== ignoring)) throw new AppError(409, "already_enrolled");
}

// The rules that do not depend on how full the class is. Checked first, so a student who cannot have a fixed
// class at all is told that before anyone is asked to accept an overfull class.
async function checkCanEnroll(db: Db, studio: StudioCtx, input: { studentId: string; slotId: string; validFrom: string; ignoring?: string; moving?: boolean }) {
  await db.transaction(async (tx) => {
    await lockStudent(tx, studio, input.studentId);
    await assertCanJoinSlot(tx, studio, input.studentId, input.slotId, input.validFrom, input.ignoring);
    if (!input.moving) await assertRoomForFixed(tx, input.studentId, input.validFrom);
  });
}

// Adds a fixed class for a student. Callers run generateSessions afterwards to book the coming sessions.
export async function createEnrollment(
  db: Db,
  studio: StudioCtx,
  input: { studentId: string; slotId: string; validFrom: string; allowOverCapacity?: boolean; ignoring?: string },
) {
  return db.transaction(async (tx) => {
    await lockStudent(tx, studio, input.studentId);
    await assertCanJoinSlot(tx, studio, input.studentId, input.slotId, input.validFrom, input.ignoring);
    await assertRoomForFixed(tx, input.studentId, input.validFrom);
    const [enrollment] = await tx
      .insert(standingEnrollments)
      .values({
        studioId: studio.id,
        studentId: input.studentId,
        slotId: input.slotId,
        validFrom: input.validFrom,
        allowOverCapacity: input.allowOverCapacity ?? false,
      })
      .returning();
    return enrollment;
  });
}

// How full the class is from a date on, so staff know before they add one more student to it.
export async function previewCapacity(db: Db, studio: StudioCtx, slotId: string, fromDate: string): Promise<CapacityPreview> {
  const dayStart = DateTime.fromISO(fromDate, { zone: studio.timezone }).startOf("day").toJSDate();
  const start = new Date(Math.max(dayStart.getTime(), Date.now())); // a class that already started cannot take anyone
  const sessions = await db
    .select({ capacity: classSessions.capacity, booked: classSessions.bookedCount })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.studioId, studio.id),
        eq(classSessions.slotId, slotId),
        eq(classSessions.status, "scheduled"),
        gte(classSessions.startsAt, start),
      ),
    )
    .orderBy(classSessions.startsAt);
  const [next] = sessions;
  return {
    capacity: next?.capacity ?? 0,
    nextBooked: next?.booked ?? 0,
    fullSessions: sessions.filter((s) => s.booked >= s.capacity).length,
    totalSessions: sessions.length,
  };
}

export async function addFixedClass(
  db: Db,
  studio: StudioCtx,
  input: { studentId: string; slotId: string; validFrom: string; allowOverCapacity: boolean },
) {
  await checkCanEnroll(db, studio, input);
  const preview = await previewCapacity(db, studio, input.slotId, input.validFrom);
  if (preview.fullSessions > 0 && !input.allowOverCapacity) throw new AppError(409, "class_full");
  const enrollment = await createEnrollment(db, studio, input);
  const generated = await generateSessions(db, studio);
  return { enrollment, generated };
}

// Open fixed classes of one student, or of the whole studio, with the class they belong to.
export async function listEnrollments(db: Db, studio: StudioCtx, studentId?: string) {
  const today = localDate(new Date(), studio.timezone);
  return db
    .select({
      id: standingEnrollments.id,
      studentId: standingEnrollments.studentId,
      slotId: classSlots.id,
      name: classSlots.name,
      weekday: classSlots.weekday,
      startTime: classSlots.startTime,
      durationMin: classSlots.durationMin,
      validFrom: standingEnrollments.validFrom,
      // Set once an end was approved: the class still runs until this day.
      validTo: standingEnrollments.validTo,
    })
    .from(standingEnrollments)
    .innerJoin(classSlots, eq(classSlots.id, standingEnrollments.slotId))
    .where(
      and(
        eq(standingEnrollments.studioId, studio.id),
        studentId ? eq(standingEnrollments.studentId, studentId) : undefined,
        openEnrollment(today),
      ),
    )
    .orderBy(classSlots.weekday, classSlots.startTime);
}

export async function listSlots(db: Db, studio: StudioCtx) {
  const today = localDate(new Date(), studio.timezone);
  return db
    .select({
      id: classSlots.id,
      name: classSlots.name,
      weekday: classSlots.weekday,
      startTime: classSlots.startTime,
      durationMin: classSlots.durationMin,
    })
    .from(classSlots)
    .where(and(eq(classSlots.studioId, studio.id), or(isNull(classSlots.activeTo), sql`${classSlots.activeTo} >= ${today}`)))
    .orderBy(classSlots.weekday, classSlots.startTime);
}

type RequestRow = typeof standingRequests.$inferSelect;

async function describe(db: Db, rows: RequestRow[]) {
  const enrollmentIds = rows.map((r) => r.fromEnrollmentId).filter((v): v is string => !!v);
  const fromEnrollments = enrollmentIds.length
    ? await db
        .select({ id: standingEnrollments.id, slotId: standingEnrollments.slotId })
        .from(standingEnrollments)
        .where(inArray(standingEnrollments.id, enrollmentIds))
    : [];
  const slotIds = [
    ...new Set([...rows.map((r) => r.toSlotId).filter((v): v is string => !!v), ...fromEnrollments.map((e) => e.slotId)]),
  ];
  const slots = slotIds.length
    ? await db
        .select({
          id: classSlots.id,
          name: classSlots.name,
          weekday: classSlots.weekday,
          startTime: classSlots.startTime,
          durationMin: classSlots.durationMin,
        })
        .from(classSlots)
        .where(inArray(classSlots.id, slotIds))
    : [];
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const slotOfEnrollment = new Map(fromEnrollments.map((e) => [e.id, e.slotId]));
  const info = (slotId: string | undefined, enrollmentId: string | null): SlotInfo | null => {
    const slot = slotId ? slotById.get(slotId) : undefined;
    return slot ? { slotId: slot.id, enrollmentId, name: slot.name, weekday: slot.weekday, startTime: slot.startTime, durationMin: slot.durationMin } : null;
  };
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    status: r.status,
    note: r.note,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    from: r.fromEnrollmentId ? info(slotOfEnrollment.get(r.fromEnrollmentId), r.fromEnrollmentId) : null,
    to: info(r.toSlotId ?? undefined, null),
  }));
}

export async function createRequest(
  db: Db,
  studio: StudioCtx,
  input: { studentId: string; fromEnrollmentId?: string; toSlotId?: string; note?: string },
) {
  const today = localDate(new Date(), studio.timezone);
  const created = await db.transaction(async (tx) => {
    await lockStudent(tx, studio, input.studentId);
    let fromSlotId: string | undefined;
    if (input.fromEnrollmentId) {
      const [from] = await tx
        .select({ id: standingEnrollments.id, slotId: standingEnrollments.slotId })
        .from(standingEnrollments)
        .where(
          and(
            eq(standingEnrollments.id, input.fromEnrollmentId),
            eq(standingEnrollments.studentId, input.studentId),
            isNull(standingEnrollments.validTo),
          ),
        );
      if (!from) throw new AppError(404, "enrollment_not_found");
      fromSlotId = from.slotId;
    }
    if (input.toSlotId) {
      if (fromSlotId === input.toSlotId) throw new AppError(400, "same_slot");
      await assertCanJoinSlot(tx, studio, input.studentId, input.toSlotId, today, input.fromEnrollmentId);
      // Joining without leaving one is checked now; a move keeps the number of fixed classes the same.
      if (!input.fromEnrollmentId) await assertRoomForFixed(tx, input.studentId, today);
    }
    const [same] = await tx
      .select({ id: standingRequests.id })
      .from(standingRequests)
      .where(
        and(
          eq(standingRequests.studentId, input.studentId),
          eq(standingRequests.status, "pending"),
          sql`${standingRequests.fromEnrollmentId} is not distinct from ${input.fromEnrollmentId ?? null}::uuid`,
          sql`${standingRequests.toSlotId} is not distinct from ${input.toSlotId ?? null}::uuid`,
        ),
      );
    if (same) throw new AppError(409, "request_pending");
    const [row] = await tx
      .insert(standingRequests)
      .values({
        studioId: studio.id,
        studentId: input.studentId,
        fromEnrollmentId: input.fromEnrollmentId,
        toSlotId: input.toSlotId,
        note: input.note || null,
      })
      .returning();
    return row;
  });
  return (await describe(db, [created]))[0];
}

// The student's own requests: everything still pending plus the latest few that were decided.
export async function listStudentRequests(db: Db, studio: StudioCtx, studentId: string) {
  const rows = await db
    .select()
    .from(standingRequests)
    .where(and(eq(standingRequests.studioId, studio.id), eq(standingRequests.studentId, studentId)))
    .orderBy(desc(standingRequests.createdAt))
    .limit(10);
  return describe(db, rows.filter((r) => r.status !== "cancelled"));
}

export async function cancelRequest(db: Db, studio: StudioCtx, studentId: string, requestId: string) {
  const [row] = await db
    .update(standingRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(
      and(
        eq(standingRequests.id, requestId),
        eq(standingRequests.studioId, studio.id),
        eq(standingRequests.studentId, studentId),
        eq(standingRequests.status, "pending"),
      ),
    )
    .returning({ id: standingRequests.id });
  if (row) return;
  const [existing] = await db
    .select({ status: standingRequests.status })
    .from(standingRequests)
    .where(and(eq(standingRequests.id, requestId), eq(standingRequests.studentId, studentId)));
  throw existing ? new AppError(409, "request_not_pending") : new AppError(404, "request_not_found");
}

// Pending requests for staff, with how full the requested class is so the warning shows before approving.
export async function listPendingRequests(db: Db, studio: StudioCtx) {
  const rows = await db
    .select()
    .from(standingRequests)
    .where(and(eq(standingRequests.studioId, studio.id), eq(standingRequests.status, "pending")))
    .orderBy(standingRequests.createdAt);
  if (rows.length === 0) return [];
  const described = await describe(db, rows);
  const people = await db
    .select({ studentId: students.id, name: users.name, phone: users.phone })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(inArray(students.id, [...new Set(rows.map((r) => r.studentId))]));
  const byStudent = new Map(people.map((p) => [p.studentId, p]));
  const from = today(studio);
  return Promise.all(
    described.map(async (r) => ({
      ...r,
      studentName: byStudent.get(r.studentId)?.name ?? "",
      studentPhone: byStudent.get(r.studentId)?.phone ?? null,
      capacity: r.to ? await previewCapacity(db, studio, r.to.slotId, from) : null,
    })),
  );
}

export async function approveRequest(
  db: Db,
  studio: StudioCtx,
  input: { requestId: string; decidedBy: string; allowOverCapacity: boolean; effectiveFrom?: string },
) {
  const effectiveFrom = input.effectiveFrom ?? today(studio);
  const [request] = await db
    .select()
    .from(standingRequests)
    .where(and(eq(standingRequests.id, input.requestId), eq(standingRequests.studioId, studio.id)));
  if (!request) throw new AppError(404, "request_not_found");
  if (request.status !== "pending") throw new AppError(409, "request_not_pending");

  // Everything that can fail is checked before anything changes, so a refused approval leaves the student as they were.
  if (request.fromEnrollmentId) {
    const [from] = await db
      .select({ id: standingEnrollments.id })
      .from(standingEnrollments)
      .where(and(eq(standingEnrollments.id, request.fromEnrollmentId), openEnrollment(effectiveFrom)));
    if (!from) throw new AppError(409, "request_outdated");
  }
  if (request.toSlotId) {
    await checkCanEnroll(db, studio, {
      studentId: request.studentId,
      slotId: request.toSlotId,
      validFrom: effectiveFrom,
      moving: !!request.fromEnrollmentId,
    });
    const preview = await previewCapacity(db, studio, request.toSlotId, effectiveFrom);
    if (preview.fullSessions > 0 && !input.allowOverCapacity) throw new AppError(409, "class_full");
  }

  // Claiming the request first means two staff members approving at once cannot both apply it.
  const [claimed] = await db
    .update(standingRequests)
    .set({ status: "approved", decidedBy: input.decidedBy, decidedAt: new Date() })
    .where(and(eq(standingRequests.id, request.id), eq(standingRequests.status, "pending")))
    .returning({ id: standingRequests.id });
  if (!claimed) throw new AppError(409, "request_not_pending");

  try {
    if (request.fromEnrollmentId) await endEnrollment(db, studio, request.fromEnrollmentId, effectiveFrom);
    if (request.toSlotId) {
      await createEnrollment(db, studio, {
        studentId: request.studentId,
        slotId: request.toSlotId,
        validFrom: effectiveFrom,
        allowOverCapacity: input.allowOverCapacity,
      });
    }
  } catch (err) {
    await db
      .update(standingRequests)
      .set({ status: "pending", decidedBy: null, decidedAt: null })
      .where(eq(standingRequests.id, request.id));
    throw err;
  }
  const generated = request.toSlotId ? await generateSessions(db, studio) : null;
  return {
    effectiveFrom,
    overbooked: generated?.standingOverbooked ?? 0,
    skipped: generated?.standingSkipped.filter((s) => s.studentId === request.studentId) ?? [],
  };
}

export async function rejectRequest(db: Db, studio: StudioCtx, input: { requestId: string; decidedBy: string; decisionNote?: string }) {
  const [row] = await db
    .update(standingRequests)
    .set({ status: "rejected", decidedBy: input.decidedBy, decidedAt: new Date(), decisionNote: input.decisionNote || null })
    .where(
      and(
        eq(standingRequests.id, input.requestId),
        eq(standingRequests.studioId, studio.id),
        eq(standingRequests.status, "pending"),
      ),
    )
    .returning({ id: standingRequests.id });
  if (row) return;
  const [existing] = await db
    .select({ id: standingRequests.id })
    .from(standingRequests)
    .where(and(eq(standingRequests.id, input.requestId), eq(standingRequests.studioId, studio.id)));
  throw existing ? new AppError(409, "request_not_pending") : new AppError(404, "request_not_found");
}
