import type { FastifyInstance } from "fastify";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { agreements, bookings, classSessions, classSlots, memberships, standingEnrollments, studios, students, users } from "../src/db/schema.js";

const TZ = "America/Sao_Paulo";

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("booking", () => {
  const config = loadConfig({ JWT_SECRET: "booking-test-secret-".repeat(3), AUTH_RATE_LIMIT_PER_MINUTE: "1000" });
  const prefix = `bk-${Date.now()}`;
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  let app: FastifyInstance;
  const studioIds: string[] = [];

  // Mondays 1, 2 and 3 weeks ahead: always inside the booking window.
  const nextMonday = () => DateTime.now().setZone(TZ).plus({ weeks: 1 }).startOf("week");
  const weekA = (day: number, hour = 10) => nextMonday().plus({ days: day, hours: hour }); // day 0 = Monday
  const weekB = (day: number, hour = 10) => nextMonday().plus({ weeks: 1, days: day, hours: hour });
  const weekC = (day: number, hour = 10) => nextMonday().plus({ weeks: 2, days: day, hours: hour });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const call = (method: "GET" | "POST" | "DELETE", url: string, token?: string, payload?: object, headers: object = {}) =>
    app.inject({
      method,
      url,
      payload,
      headers: { ...(token ? bearer(token) : {}), ...headers } as Record<string, string>,
    });

  async function newStudio(label: string) {
    const [studio] = await db
      .insert(studios)
      .values({ name: label, slug: `${prefix}-${label}`, timezone: TZ })
      .returning();
    studioIds.push(studio.id);
    const [slot] = await db
      .insert(classSlots)
      .values({ studioId: studio.id, name: "Direct", weekday: 1, startTime: "05:00", durationMin: 60, capacity: 10, activeFrom: "2020-01-01" })
      .returning();
    let counter = 0;

    async function member(name: string, role: "owner" | "staff" | "student") {
      const [user] = await db
        .insert(users)
        .values({ email: `${prefix}-${label}-${name}-${counter++}@example.com`, name, passwordHash: "x" })
        .returning();
      await db.insert(memberships).values({ studioId: studio.id, userId: user.id, role, status: "active" });
      const token = await signAccessToken(config, { userId: user.id, studioId: studio.id, role, mustChangePassword: false });
      return { user, token };
    }
    async function student(name: string, weeklyLimit: number | null = 5) {
      const m = await member(name, "student");
      const [row] = await db.insert(students).values({ studioId: studio.id, userId: m.user.id }).returning();
      if (weeklyLimit !== null) {
        await db.insert(agreements).values({ studioId: studio.id, studentId: row.id, weeklyLimit, validFrom: "2020-01-01" });
      }
      return { ...m, studentId: row.id };
    }
    async function session(at: DateTime, capacity = 10) {
      const [row] = await db
        .insert(classSessions)
        .values({ studioId: studio.id, slotId: slot.id, startsAt: at.toUTC().toJSDate(), capacity })
        .returning();
      return row;
    }
    const reload = async (id: string) => (await db.select().from(classSessions).where(eq(classSessions.id, id)))[0];
    return { studio, member, student, session, reload };
  }

  beforeAll(async () => {
    ({ db, pool } = createDb());
    app = buildApp({ db, config });
  });

  afterAll(async () => {
    await app.close();
    for (const id of studioIds) {
      for (const table of ["bookings", "standing_enrollments", "agreements", "class_sessions", "class_slots", "students", "memberships", "refresh_tokens"]) {
        await db.execute(sql.raw(`delete from ${table} where studio_id = '${id}'`));
      }
      await db.execute(sql.raw(`delete from studios where id = '${id}'`));
    }
    await db.execute(sql`delete from users where email like ${prefix + "-%"}`);
    await pool.end();
  });

  it("lists classes with spots left and marks the student's own booking", async () => {
    const t = await newStudio("list");
    const s = await t.student("Ana");
    const session = await t.session(weekA(1), 4);
    const date = weekA(1).toISODate()!;
    const list = async () => (await call("GET", `/sessions?from=${date}&to=${date}`, s.token)).json();

    expect(await list()).toMatchObject([{ id: session.id, capacity: 4, spotsLeft: 4, myBookingId: null }]);
    const booked = await call("POST", "/bookings", s.token, { sessionId: session.id });
    expect(booked.statusCode).toBe(201);
    expect(await list()).toMatchObject([{ spotsLeft: 3, myBookingId: booked.json().booking.id }]);
    expect((await call("GET", "/sessions?from=2026-13-40", s.token)).statusCode).toBe(400);
  });

  it("rejects duplicates, missing agreements and wrong roles, and honors idempotency keys", async () => {
    const t = await newStudio("basic");
    const s = await t.student("Ana");
    const noDeal = await t.student("Nodeal", null);
    const staff = await t.member("Staff", "staff");
    const session = await t.session(weekA(1), 5);

    expect((await call("POST", "/bookings", s.token, { sessionId: session.id })).statusCode).toBe(201);
    const dup = await call("POST", "/bookings", s.token, { sessionId: session.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("already_booked");
    expect((await t.reload(session.id)).bookedCount).toBe(1);

    const denied = await call("POST", "/bookings", noDeal.token, { sessionId: session.id });
    expect(denied.json().error).toBe("no_agreement");
    expect((await call("POST", "/bookings", staff.token, { sessionId: session.id })).statusCode).toBe(403);
    expect((await call("POST", "/bookings", undefined, { sessionId: session.id })).statusCode).toBe(401);
    expect((await call("POST", "/staff/slots", s.token, {})).statusCode).toBe(403);

    const other = await t.session(weekA(2), 5);
    const first = await call("POST", "/bookings", s.token, { sessionId: other.id }, { "idempotency-key": "retry-1" });
    const retry = await call("POST", "/bookings", s.token, { sessionId: other.id }, { "idempotency-key": "retry-1" });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().booking.id).toBe(first.json().booking.id);
    expect((await t.reload(other.id)).bookedCount).toBe(1);

    // Another student reusing the same key gets their own booking, never someone else's.
    const stranger = await t.student("Stranger");
    const theirs = await call("POST", "/bookings", stranger.token, { sessionId: other.id }, { "idempotency-key": "retry-1" });
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().booking.id).not.toBe(first.json().booking.id);
    expect(theirs.json().booking.studentId).toBe(stranger.studentId);
  });

  it("enforces the weekly limit per booking week, and cancelling frees a place", async () => {
    const t = await newStudio("limit");
    const s = await t.student("Lia", 2);
    const [tue, wed, thu] = [await t.session(weekA(1)), await t.session(weekA(2)), await t.session(weekA(3))];
    const nextWeek = await t.session(weekB(1));

    expect((await call("POST", "/bookings", s.token, { sessionId: tue.id })).statusCode).toBe(201);
    const second = await call("POST", "/bookings", s.token, { sessionId: wed.id });
    expect(second.statusCode).toBe(201);
    const over = await call("POST", "/bookings", s.token, { sessionId: thu.id });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe("weekly_limit_reached");
    expect((await t.reload(thu.id)).bookedCount).toBe(0);

    expect((await call("POST", "/bookings", s.token, { sessionId: nextWeek.id })).statusCode).toBe(201);
    const usage = await call("GET", `/me/weekly-usage?date=${weekA(1).toISODate()}`, s.token);
    expect(usage.json()).toMatchObject({ used: 2, weeklyLimit: 2, remaining: 0 });

    expect((await call("DELETE", `/bookings/${second.json().booking.id}`, s.token)).statusCode).toBe(200);
    expect((await call("POST", "/bookings", s.token, { sessionId: thu.id })).statusCode).toBe(201);
  });

  it("never oversells a class when many students book the last seats at once", async () => {
    const t = await newStudio("capacity");
    const session = await t.session(weekA(1, 9), 3);
    const group = await Promise.all(Array.from({ length: 12 }, (_, i) => t.student(`S${i}`)));

    const results = await Promise.all(group.map((s) => call("POST", "/bookings", s.token, { sessionId: session.id })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === "class_full")).toBe(true);
    expect((await t.reload(session.id)).bookedCount).toBe(3);

    const owner = await t.member("Owner", "owner");
    const roster = (await call("GET", `/staff/sessions/${session.id}/roster`, owner.token)).json();
    expect(roster.roster).toHaveLength(3);
  });

  it("holds one student to their limit even when they tap many classes at once", async () => {
    const t = await newStudio("tapper");
    const s = await t.student("Tapper", 1);
    const sessions = await Promise.all([0, 1, 2, 3, 4].map((d) => t.session(weekC(d, 8))));

    const results = await Promise.all(sessions.map((x) => call("POST", "/bookings", s.token, { sessionId: x.id })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409 && r.json().error === "weekly_limit_reached")).toHaveLength(4);
    const counts = await Promise.all(sessions.map((x) => t.reload(x.id)));
    expect(counts.reduce((sum, x) => sum + x.bookedCount, 0)).toBe(1);
  });

  it("applies the cancellation cutoff to students but not staff, and refuses started classes", async () => {
    const t = await newStudio("cutoff");
    const s = await t.student("Cut");
    const other = await t.student("Other");
    const owner = await t.member("Owner", "owner");

    const soon = await t.session(DateTime.now().plus({ minutes: 30 }));
    const booked = await call("POST", "/bookings", s.token, { sessionId: soon.id });
    expect(booked.statusCode).toBe(201);
    const id = booked.json().booking.id;

    expect((await call("DELETE", `/bookings/${id}`, other.token)).statusCode).toBe(404);
    const late = await call("DELETE", `/bookings/${id}`, s.token);
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe("too_late_to_cancel");
    expect((await t.reload(soon.id)).bookedCount).toBe(1);
    expect((await call("DELETE", `/bookings/${id}`, owner.token)).statusCode).toBe(200);
    expect((await t.reload(soon.id)).bookedCount).toBe(0);
    expect((await call("DELETE", `/bookings/${id}`, owner.token)).json().error).toBe("booking_not_active");

    const started = await t.session(DateTime.now().minus({ minutes: 5 }));
    expect((await call("POST", "/bookings", s.token, { sessionId: started.id })).json().error).toBe("class_started");
    const far = await t.session(DateTime.now().plus({ days: 60 }));
    expect((await call("POST", "/bookings", s.token, { sessionId: far.id })).json().error).toBe("outside_booking_window");
  });

  it("swaps a booking for one class without changing the limit, and keeps the original if the swap fails", async () => {
    const t = await newStudio("swap");
    const s = await t.student("Swapper", 1);
    const blocker = await t.student("Blocker");
    const p = await t.session(weekA(1, 11), 5);
    const q = await t.session(weekA(3, 11), 5);
    const full = await t.session(weekA(4, 11), 1);
    expect((await call("POST", "/bookings", blocker.token, { sessionId: full.id })).statusCode).toBe(201);

    const original = (await call("POST", "/bookings", s.token, { sessionId: p.id })).json().booking;
    const swapped = await call("POST", `/bookings/${original.id}/swap`, s.token, { toSessionId: q.id });
    expect(swapped.statusCode).toBe(201);
    expect(swapped.json().booking.sessionId).toBe(q.id);
    expect([(await t.reload(p.id)).bookedCount, (await t.reload(q.id)).bookedCount]).toEqual([0, 1]);

    const mine = (await call("GET", "/me/bookings", s.token)).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ sessionId: q.id, source: "one_off", replacesBookingId: original.id });
    expect((await call("GET", `/me/weekly-usage?date=${weekA(1).toISODate()}`, s.token)).json().used).toBe(1);

    const failed = await call("POST", `/bookings/${swapped.json().booking.id}/swap`, s.token, { toSessionId: full.id });
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error).toBe("class_full");
    expect([(await t.reload(q.id)).bookedCount, (await t.reload(full.id)).bookedCount]).toEqual([1, 1]);
    expect((await call("GET", "/me/bookings", s.token)).json().map((b: { sessionId: string }) => b.sessionId)).toEqual([q.id]);

    expect((await call("POST", `/bookings/${original.id}/swap`, s.token, { toSessionId: q.id })).json().error).toBe("booking_not_active");
    const stranger = await t.student("Stranger");
    expect((await call("POST", `/bookings/${swapped.json().booking.id}/swap`, stranger.token, { toSessionId: p.id })).statusCode).toBe(404);
  });

  it("handles opposite swaps at the same moment without deadlocking", async () => {
    const t = await newStudio("deadlock");
    const a = await t.student("A");
    const b = await t.student("B");
    const u = await t.session(weekC(0, 12), 1);
    const v = await t.session(weekC(1, 12), 1);
    const ba = (await call("POST", "/bookings", a.token, { sessionId: u.id })).json().booking;
    const bb = (await call("POST", "/bookings", b.token, { sessionId: v.id })).json().booking;

    const [r1, r2] = await Promise.all([
      call("POST", `/bookings/${ba.id}/swap`, a.token, { toSessionId: v.id }),
      call("POST", `/bookings/${bb.id}/swap`, b.token, { toSessionId: u.id }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([409, 409]);
    expect([(await t.reload(u.id)).bookedCount, (await t.reload(v.id)).bookedCount]).toEqual([1, 1]);
  });

  it("builds the timetable, generates sessions, and books and ends fixed schedules", async () => {
    const t = await newStudio("generate");
    await db.delete(classSlots).where(eq(classSlots.studioId, t.studio.id)); // start from an empty timetable
    const owner = await t.member("Owner", "owner");

    const monday = await call("POST", "/staff/slots", owner.token, { name: "Monday 07:00", weekday: 1, startTime: "07:00", durationMin: 60, capacity: 2 });
    expect(monday.statusCode).toBe(201);
    const tuesday = await call("POST", "/staff/slots", owner.token, { name: "Tuesday 07:00", weekday: 2, startTime: "07:00", durationMin: 60, capacity: 2 });
    expect((await call("POST", "/staff/slots", owner.token, { name: "Sat", weekday: 6, startTime: "09:00", durationMin: 60, capacity: 5 })).json().error).toBe("weekday_not_in_booking_week");
    expect((await call("GET", "/staff/slots", owner.token)).json()).toHaveLength(2);

    const first = (await call("POST", "/staff/sessions/generate", owner.token, {})).json();
    expect(first.sessionsCreated).toBeGreaterThanOrEqual(6);
    expect((await call("POST", "/staff/sessions/generate", owner.token, {})).json().sessionsCreated).toBe(0);

    const ana = await t.student("Ana", 3);
    const enroll = await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, owner.token, { slotId: monday.json().slot.id });
    expect(enroll.statusCode).toBe(201);
    expect(enroll.json().generated.standingBooked).toBeGreaterThanOrEqual(3);
    expect((await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, owner.token, { slotId: monday.json().slot.id })).json().error).toBe("already_enrolled");

    const mine = (await call("GET", "/me/bookings", ana.token)).json() as { id: string; source: string }[];
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.every((b) => b.source === "standing")).toBe(true);

    // An absence: cancelling one week must not be undone by running generation again.
    expect((await call("DELETE", `/bookings/${mine[0].id}`, ana.token)).statusCode).toBe(200);
    const again = (await call("POST", "/staff/sessions/generate", owner.token, {})).json();
    expect(again.standingBooked).toBe(0);
    expect((await call("GET", "/me/bookings", ana.token)).json()).toHaveLength(mine.length - 1);

    // A missing agreement and a full class are refused; staff can accept the full class on purpose.
    const [b, c, d] = [await t.student("B", 3), await t.student("C", 3), await t.student("D", null)];
    for (const s of [b, c]) {
      await call("POST", `/staff/students/${s.studentId}/standing-enrollments`, owner.token, { slotId: tuesday.json().slot.id });
    }
    const third = await call("POST", `/staff/students/${d.studentId}/standing-enrollments`, owner.token, { slotId: tuesday.json().slot.id });
    expect([third.statusCode, third.json().error]).toEqual([403, "no_agreement"]);
    const late = await t.student("E", 3);
    const overflow = await call("POST", `/staff/students/${late.studentId}/standing-enrollments`, owner.token, { slotId: tuesday.json().slot.id });
    expect([overflow.statusCode, overflow.json().error]).toEqual([409, "class_full"]);
    const accepted = await call("POST", `/staff/students/${late.studentId}/standing-enrollments`, owner.token, { slotId: tuesday.json().slot.id, allowOverCapacity: true });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().generated.standingOverbooked).toBeGreaterThanOrEqual(1);
    expect(accepted.json().generated.standingSkipped).toEqual([]);

    // Ending the Monday enrollment from today cancels the remaining standing bookings.
    const ended = await call("POST", `/staff/standing-enrollments/${enroll.json().enrollment.id}/end`, owner.token, {});
    expect(ended.json().bookingsCancelled).toBe(mine.length - 1);
    expect((await call("GET", "/me/bookings", ana.token)).json()).toHaveLength(0);
    expect((await call("POST", "/staff/sessions/generate", owner.token, {})).json().standingBooked).toBe(0);

    // Ending from a later date keeps the earlier weeks and records when it stopped.
    const again2 = await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, owner.token, { slotId: monday.json().slot.id });
    expect(again2.statusCode).toBe(201);
    const before = (await call("GET", "/me/bookings", ana.token)).json() as { startsAt: string }[];
    expect(before.length).toBeGreaterThanOrEqual(3);
    const cutoffDate = DateTime.fromISO(before[1].startsAt, { zone: TZ }).toISODate()!;
    const partial = await call("POST", `/staff/standing-enrollments/${again2.json().enrollment.id}/end`, owner.token, { effectiveFrom: cutoffDate });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().bookingsCancelled).toBe(before.length - 1);
    expect((await call("GET", "/me/bookings", ana.token)).json()).toHaveLength(1);
    const [row] = await db.select().from(standingEnrollments).where(eq(standingEnrollments.id, again2.json().enrollment.id));
    expect(row.validTo).toBe(DateTime.fromISO(cutoffDate).minus({ days: 1 }).toISODate());
  });

  it("changes weekly limits while keeping history", async () => {
    const t = await newStudio("agreement");
    const owner = await t.member("Owner", "owner");
    const s = await t.student("Limit", 2);
    const today = DateTime.now().setZone(TZ).toISODate()!;
    const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()!;

    const change = await call("POST", `/staff/students/${s.studentId}/agreement`, owner.token, { weeklyLimit: 4, validFrom: tomorrow });
    expect(change.statusCode).toBe(200);
    const rows = await db.select().from(agreements).where(eq(agreements.studentId, s.studentId)).orderBy(agreements.validFrom);
    expect(rows).toHaveLength(2);
    expect(rows[0].validTo).toBe(today);
    expect(rows[1]).toMatchObject({ weeklyLimit: 4, validFrom: tomorrow, validTo: null });

    const sameDay = await call("POST", `/staff/students/${s.studentId}/agreement`, owner.token, { weeklyLimit: 3, validFrom: tomorrow });
    expect(sameDay.json().agreement.weeklyLimit).toBe(3);
    expect(await db.select().from(agreements).where(eq(agreements.studentId, s.studentId))).toHaveLength(2);
    expect((await call("POST", `/staff/students/${s.studentId}/agreement`, owner.token, { weeklyLimit: 1, validFrom: "2021-01-01" })).json().error).toBe("starts_before_current_agreement");
    const usage = (await call("GET", `/me/weekly-usage?date=${tomorrow}`, s.token)).json();
    expect(usage.weeklyLimit).toBe(3);
  });

  it("cancels a class, gives the students their weekly class back, and tells staff who to contact", async () => {
    const t = await newStudio("cancel-class");
    const owner = await t.member("Owner", "owner");
    const [ana, bia, caio] = await Promise.all(["Ana", "Bia", "Caio"].map((n) => t.student(n, 1)));
    const holiday = await t.session(weekA(1, 18), 5);
    const other = await t.session(weekA(3, 18), 5);
    for (const s of [ana, bia, caio]) {
      expect((await call("POST", "/bookings", s.token, { sessionId: holiday.id })).statusCode).toBe(201);
    }
    expect((await call("POST", "/bookings", ana.token, { sessionId: other.id })).json().error).toBe("weekly_limit_reached");

    expect((await call("POST", `/staff/sessions/${holiday.id}/cancel`, ana.token, {})).statusCode).toBe(403);
    const res = await call("POST", `/staff/sessions/${holiday.id}/cancel`, owner.token, { note: "Holiday" });
    expect(res.statusCode).toBe(200);
    expect(res.json().bookingsCancelled).toBe(3);
    expect(res.json().affected.map((a: { name: string }) => a.name)).toEqual(["Ana", "Bia", "Caio"]);
    expect(await t.reload(holiday.id)).toMatchObject({ status: "cancelled", bookedCount: 0, cancelNote: "Holiday" });

    // The cancelled class no longer counts, so Ana can book another one that week.
    expect((await call("GET", `/me/weekly-usage?date=${weekA(1).toISODate()}`, ana.token)).json().used).toBe(0);
    expect((await call("POST", "/bookings", ana.token, { sessionId: other.id })).statusCode).toBe(201);
    expect((await call("POST", "/bookings", bia.token, { sessionId: holiday.id })).json().error).toBe("session_cancelled");

    // Students do not see the cancelled class in the schedule, staff do; students still see why a booking vanished.
    const date = weekA(1).toISODate()!;
    const studentView = (await call("GET", `/sessions?from=${date}&to=${date}`, caio.token)).json();
    const staffView = (await call("GET", `/sessions?from=${date}&to=${date}`, owner.token)).json();
    expect(studentView.map((x: { id: string }) => x.id)).not.toContain(holiday.id);
    expect(staffView).toMatchObject([{ id: holiday.id, status: "cancelled", cancelNote: "Holiday" }]);
    const mine = (await call("GET", "/me/bookings", caio.token)).json();
    expect(mine).toMatchObject([{ sessionId: holiday.id, status: "cancelled", cancelReason: "class_cancelled", cancelNote: "Holiday" }]);

    expect((await call("POST", `/staff/sessions/${holiday.id}/cancel`, owner.token, {})).json().error).toBe("session_already_cancelled");
    expect((await call("POST", `/staff/sessions/${crypto.randomUUID()}/cancel`, owner.token, {})).statusCode).toBe(404);

    const kept = (await call("POST", "/bookings", caio.token, { sessionId: other.id })).json().booking;
    const swap = await call("POST", `/bookings/${kept.id}/swap`, caio.token, { toSessionId: holiday.id });
    expect(swap.json().error).toBe("session_cancelled");
    expect((await call("GET", "/me/bookings", caio.token)).json().filter((b: { status: string }) => b.status === "booked")).toHaveLength(1);
  });

  it("cancels every class on a day (a holiday) and leaves other days alone", async () => {
    const t = await newStudio("cancel-day");
    const owner = await t.member("Owner", "owner");
    const s = await t.student("Day", 5);
    const [morning, noon, evening] = [await t.session(weekA(2, 8)), await t.session(weekA(2, 12)), await t.session(weekA(2, 18))];
    const nextDay = await t.session(weekA(3, 8));
    for (const x of [morning, evening, nextDay]) {
      expect((await call("POST", "/bookings", s.token, { sessionId: x.id })).statusCode).toBe(201);
    }

    const date = weekA(2).toISODate()!;
    const res = await call("POST", "/staff/sessions/cancel-day", owner.token, { date, note: "Holiday" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ classesCancelled: 3, bookingsCancelled: 2 });
    expect((await t.reload(noon.id)).status).toBe("cancelled");
    expect(await t.reload(nextDay.id)).toMatchObject({ status: "scheduled", bookedCount: 1 });
    expect((await call("POST", "/staff/sessions/cancel-day", owner.token, { date })).json().classesCancelled).toBe(0);
    expect((await call("POST", "/staff/sessions/cancel-day", owner.token, { date: "tomorrow" })).statusCode).toBe(400);
    expect((await t.reload(morning.id)).bookedCount).toBe(0);
  });

  it("does not bring a cancelled class back when sessions are generated again", async () => {
    const t = await newStudio("cancel-gen");
    await db.delete(classSlots).where(eq(classSlots.studioId, t.studio.id));
    const owner = await t.member("Owner", "owner");
    const slot = (await call("POST", "/staff/slots", owner.token, { name: "Tue 07:00", weekday: 2, startTime: "07:00", durationMin: 60, capacity: 3 })).json().slot;
    await call("POST", "/staff/sessions/generate", owner.token, {});
    const ana = await t.student("Ana", 3);
    const enroll = await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, owner.token, { slotId: slot.id });
    expect(enroll.json().generated.standingBooked).toBeGreaterThanOrEqual(3);

    const mine = (await call("GET", "/me/bookings", ana.token)).json() as { sessionId: string }[];
    const called = mine[1].sessionId;
    expect((await call("POST", `/staff/sessions/${called}/cancel`, owner.token, {})).json().bookingsCancelled).toBe(1);

    const again = (await call("POST", "/staff/sessions/generate", owner.token, {})).json();
    expect(again).toMatchObject({ sessionsCreated: 0, standingBooked: 0 });
    expect((await t.reload(called)).status).toBe("cancelled");
    const after = (await call("GET", "/me/bookings", ana.token)).json() as { status: string }[];
    expect(after.filter((b) => b.status === "booked")).toHaveLength(mine.length - 1);
    expect(after.filter((b) => b.status === "cancelled")).toHaveLength(1);
  });

  it("stays consistent when a class is cancelled at the same moment students cancel or book", async () => {
    const t = await newStudio("race");
    const owner = await t.member("Owner", "owner");
    const noServerErrors = (rs: { statusCode: number }[]) => expect(rs.filter((r) => r.statusCode >= 500)).toHaveLength(0);
    const activeIn = async (sessionId: string) =>
      (await db.select().from(bookings).where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "booked")))).length;

    // Students cancel their own seats while staff cancel the class.
    for (let round = 0; round < 5; round++) {
      const session = await t.session(weekC(round, 6 + round), 6);
      const group = await Promise.all(Array.from({ length: 6 }, (_, i) => t.student(`C${round}-${i}`, 5)));
      const ids = await Promise.all(
        group.map(async (g) => (await call("POST", "/bookings", g.token, { sessionId: session.id })).json().booking.id as string),
      );
      const results = await Promise.all([
        call("POST", `/staff/sessions/${session.id}/cancel`, owner.token, {}),
        ...group.map((g, i) => call("DELETE", `/bookings/${ids[i]}`, g.token)),
      ]);
      noServerErrors(results);
      expect(results[0].statusCode).toBe(200);
      expect(results.slice(1).every((r) => r.statusCode === 200 || r.json().error === "booking_not_active")).toBe(true);
      expect(await t.reload(session.id)).toMatchObject({ status: "cancelled", bookedCount: 0 });
      expect(await activeIn(session.id)).toBe(0);
    }

    // Students try to book while staff cancel the class: nobody may end up holding a seat in it.
    for (let round = 0; round < 5; round++) {
      const session = await t.session(weekC(round, 14 + round), 6);
      const group = await Promise.all(Array.from({ length: 6 }, (_, i) => t.student(`B${round}-${i}`, 5)));
      const results = await Promise.all([
        call("POST", `/staff/sessions/${session.id}/cancel`, owner.token, {}),
        ...group.map((g) => call("POST", "/bookings", g.token, { sessionId: session.id })),
      ]);
      noServerErrors(results);
      expect(results[0].statusCode).toBe(200);
      expect(results.slice(1).every((r) => r.statusCode === 201 || r.json().error === "session_cancelled")).toBe(true);
      expect(await t.reload(session.id)).toMatchObject({ status: "cancelled", bookedCount: 0 });
      expect(await activeIn(session.id)).toBe(0);
    }
  });
});
