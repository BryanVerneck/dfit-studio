import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { agreements, classSessions, classSlots, memberships, standingEnrollments, studios, students, users } from "../src/db/schema.js";

const TZ = "America/Sao_Paulo";

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("fixed class requests", () => {
  const config = loadConfig({ JWT_SECRET: "standing-test-secret-".repeat(3), AUTH_RATE_LIMIT_PER_MINUTE: "1000" });
  const prefix = `sr-${Date.now()}`;
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  let app: FastifyInstance;
  const studioIds: string[] = [];

  const call = (method: "GET" | "POST", url: string, token: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

  // A studio with a Monday and a Tuesday class (capacity 2) and its sessions for the coming weeks.
  async function newStudio(label: string) {
    const [studio] = await db.insert(studios).values({ name: label, slug: `${prefix}-${label}`, timezone: TZ }).returning();
    studioIds.push(studio.id);
    let counter = 0;
    async function member(name: string, role: "owner" | "student") {
      const [user] = await db
        .insert(users)
        .values({ email: `${prefix}-${label}-${name}-${counter++}@example.com`, name, passwordHash: "x" })
        .returning();
      await db.insert(memberships).values({ studioId: studio.id, userId: user.id, role, status: "active" });
      const token = await signAccessToken(config, { userId: user.id, studioId: studio.id, role, mustChangePassword: false });
      return { user, token };
    }
    async function student(name: string, weeklyLimit: number | null = 3) {
      const m = await member(name, "student");
      const [row] = await db.insert(students).values({ studioId: studio.id, userId: m.user.id }).returning();
      if (weeklyLimit !== null) {
        await db.insert(agreements).values({ studioId: studio.id, studentId: row.id, weeklyLimit, validFrom: "2020-01-01" });
      }
      return { ...m, studentId: row.id };
    }
    const owner = await member("Owner", "owner");
    const slot = async (weekday: number, name: string) =>
      (await db.insert(classSlots).values({ studioId: studio.id, name, weekday, startTime: "07:00", durationMin: 60, capacity: 2, activeFrom: "2020-01-01" }).returning())[0];
    const monday = await slot(1, "Monday 07:00");
    const tuesday = await slot(2, "Tuesday 07:00");
    expect((await call("POST", "/staff/sessions/generate", owner.token, {})).statusCode).toBe(200);
    return { studio, owner, student, monday, tuesday };
  }

  // Fixed classes that keep going. One that was ended still shows (with an end date) until its last day.
  const myFixed = async (token: string) =>
    ((await call("GET", "/me/standing-enrollments", token)).json() as { id: string; slotId: string; validTo: string | null }[]).filter((e) => e.validTo === null);
  const myBookings = async (token: string) => (await call("GET", "/me/bookings", token)).json() as { id: string; source: string; name: string }[];

  beforeAll(async () => {
    ({ db, pool } = createDb());
    app = buildApp({ db, config });
  });

  afterAll(async () => {
    await app.close();
    for (const id of studioIds) {
      for (const table of ["standing_requests", "bookings", "standing_enrollments", "agreements", "class_sessions", "class_slots", "students", "memberships", "refresh_tokens"]) {
        await db.execute(sql.raw(`delete from ${table} where studio_id = '${id}'`));
      }
      await db.execute(sql.raw(`delete from studios where id = '${id}'`));
    }
    await db.execute(sql`delete from users where email like ${prefix + "-%"}`);
    await pool.end();
  });

  it("lets a student ask for a fixed class and staff approve it", async () => {
    const t = await newStudio("add");
    const ana = await t.student("Ana");
    expect(((await call("GET", "/me/slots", ana.token)).json() as unknown[]).length).toBe(2);

    const asked = await call("POST", "/me/standing-requests", ana.token, { toSlotId: t.monday.id, note: "Trabalho de manhã" });
    expect(asked.statusCode).toBe(201);
    expect(asked.json().request).toMatchObject({ status: "pending", from: null, to: { name: "Monday 07:00" } });
    expect((await call("POST", "/me/standing-requests", ana.token, { toSlotId: t.monday.id })).json().error).toBe("request_pending");
    expect(await myBookings(ana.token)).toHaveLength(0);

    const pending = (await call("GET", "/staff/standing-requests", t.owner.token)).json();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ studentName: "Ana", note: "Trabalho de manhã", capacity: { fullSessions: 0 } });

    const approved = await call("POST", `/staff/standing-requests/${pending[0].id}/approve`, t.owner.token, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().skipped).toEqual([]);
    expect(await myFixed(ana.token)).toHaveLength(1);
    const bookings = await myBookings(ana.token);
    expect(bookings.length).toBeGreaterThanOrEqual(3);
    expect(bookings.every((b) => b.source === "standing")).toBe(true);
    expect((await call("GET", "/staff/standing-requests", t.owner.token)).json()).toHaveLength(0);
    expect((await call("POST", `/staff/standing-requests/${pending[0].id}/approve`, t.owner.token, {})).json().error).toBe("request_not_pending");
  });

  it("moves a student to another time and ends the old one", async () => {
    const t = await newStudio("move");
    const ana = await t.student("Ana");
    const first = await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, t.owner.token, { slotId: t.monday.id });
    expect(first.statusCode).toBe(201);
    const [current] = await myFixed(ana.token);

    // Same time, or a time that is already hers, is refused.
    expect((await call("POST", "/me/standing-requests", ana.token, { fromEnrollmentId: current.id, toSlotId: t.monday.id })).json().error).toBe("same_slot");
    expect((await call("POST", "/me/standing-requests", ana.token, { toSlotId: t.monday.id })).json().error).toBe("already_enrolled");

    const asked = await call("POST", "/me/standing-requests", ana.token, { fromEnrollmentId: current.id, toSlotId: t.tuesday.id });
    expect(asked.statusCode).toBe(201);
    const approved = await call("POST", `/staff/standing-requests/${asked.json().request.id}/approve`, t.owner.token, {});
    expect(approved.statusCode).toBe(200);

    const fixed = await myFixed(ana.token);
    expect(fixed.map((f) => f.slotId)).toEqual([t.tuesday.id]);
    const names = new Set((await myBookings(ana.token)).map((b) => b.name));
    expect(names.has("Tuesday 07:00")).toBe(true);
  });

  it("asks staff before a full class takes one more student", async () => {
    const t = await newStudio("full");
    for (const name of ["B", "C"]) {
      const s = await t.student(name);
      expect((await call("POST", `/staff/students/${s.studentId}/standing-enrollments`, t.owner.token, { slotId: t.tuesday.id })).statusCode).toBe(201);
    }
    const dani = await t.student("Dani");
    const asked = await call("POST", "/me/standing-requests", dani.token, { toSlotId: t.tuesday.id });
    expect(asked.statusCode).toBe(201);

    const [pending] = (await call("GET", "/staff/standing-requests", t.owner.token)).json();
    expect(pending.capacity).toMatchObject({ capacity: 2, nextBooked: 2 });
    expect(pending.capacity.fullSessions).toBeGreaterThanOrEqual(3);

    const refused = await call("POST", `/staff/standing-requests/${pending.id}/approve`, t.owner.token, {});
    expect([refused.statusCode, refused.json().error]).toEqual([409, "class_full"]);
    expect(await myFixed(dani.token)).toHaveLength(0);

    const accepted = await call("POST", `/staff/standing-requests/${pending.id}/approve`, t.owner.token, { allowOverCapacity: true });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().overbooked).toBeGreaterThanOrEqual(3);
    expect(await myBookings(dani.token)).not.toHaveLength(0);
    const rows = await db.select().from(classSessions).where(eq(classSessions.slotId, t.tuesday.id));
    expect(rows.some((r) => r.capacity === 3 && r.bookedCount === 3)).toBe(true);
    expect((await db.select().from(standingEnrollments).where(eq(standingEnrollments.studentId, dani.studentId)))[0].allowOverCapacity).toBe(true);
  });

  it("keeps fixed classes within the weekly limit", async () => {
    const t = await newStudio("limit");
    const ana = await t.student("Ana", 1);
    expect((await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, t.owner.token, { slotId: t.monday.id })).statusCode).toBe(201);
    expect((await call("POST", "/me/standing-requests", ana.token, { toSlotId: t.tuesday.id })).json().error).toBe("fixed_limit_reached");
    expect((await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, t.owner.token, { slotId: t.tuesday.id })).json().error).toBe("fixed_limit_reached");

    // After the limit goes up there is room again.
    expect((await call("POST", `/staff/students/${ana.studentId}/agreement`, t.owner.token, { weeklyLimit: 2 })).statusCode).toBe(200);
    expect((await call("POST", "/me/standing-requests", ana.token, { toSlotId: t.tuesday.id })).statusCode).toBe(201);

    const noPlan = await t.student("Bia", null);
    expect((await call("POST", "/me/standing-requests", noPlan.token, { toSlotId: t.monday.id })).json().error).toBe("no_agreement");
  });

  it("ends a fixed class on request, and lets staff reject or the student withdraw", async () => {
    const t = await newStudio("end");
    const ana = await t.student("Ana");
    await call("POST", `/staff/students/${ana.studentId}/standing-enrollments`, t.owner.token, { slotId: t.monday.id });
    const [current] = await myFixed(ana.token);

    const leave = await call("POST", "/me/standing-requests", ana.token, { fromEnrollmentId: current.id });
    expect(leave.statusCode).toBe(201);
    const rejected = await call("POST", `/staff/standing-requests/${leave.json().request.id}/reject`, t.owner.token, { decisionNote: "Fale com a recepção" });
    expect(rejected.statusCode).toBe(200);
    const mine = (await call("GET", "/me/standing-requests", ana.token)).json();
    expect(mine[0]).toMatchObject({ status: "rejected", decisionNote: "Fale com a recepção" });
    expect(await myFixed(ana.token)).toHaveLength(1);

    const again = await call("POST", "/me/standing-requests", ana.token, { fromEnrollmentId: current.id });
    expect((await call("POST", `/me/standing-requests/${again.json().request.id}/cancel`, ana.token)).statusCode).toBe(200);
    expect((await call("POST", `/me/standing-requests/${again.json().request.id}/cancel`, ana.token)).json().error).toBe("request_not_pending");

    const last = await call("POST", "/me/standing-requests", ana.token, { fromEnrollmentId: current.id });
    expect((await call("POST", `/staff/standing-requests/${last.json().request.id}/approve`, t.owner.token, {})).statusCode).toBe(200);
    expect(await myFixed(ana.token)).toHaveLength(0);
    expect((await myBookings(ana.token)).length).toBeLessThanOrEqual(1); // at most a class later today, before the change starts

    // Students cannot use the staff side.
    expect((await call("GET", "/staff/standing-requests", ana.token)).statusCode).toBe(403);
  });
});
