import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import { isDue, runGenerationForAllStudios } from "../src/jobs/generation.js";
import { agreements, bookings, classSessions, classSlots, memberships, standingEnrollments, studios, students, users } from "../src/db/schema.js";

const quiet = { info: () => {}, error: () => {} };

describe("isDue", () => {
  const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone });

  it("is due only during the chosen local hour, once per local day", () => {
    expect(isDue(at("2026-10-15T03:20:00", "America/Sao_Paulo"), 3, undefined)).toBe(true);
    expect(isDue(at("2026-10-15T03:20:00", "America/Sao_Paulo"), 3, "2026-10-15")).toBe(false);
    expect(isDue(at("2026-10-15T03:20:00", "America/Sao_Paulo"), 3, "2026-10-14")).toBe(true);
    expect(isDue(at("2026-10-15T04:00:00", "America/Sao_Paulo"), 3, undefined)).toBe(false);
  });

  it("uses each studio's own time zone", () => {
    const instant = DateTime.fromISO("2026-10-15T06:30:00Z");
    expect(isDue(instant.setZone("America/Sao_Paulo"), 3, undefined)).toBe(true); // 03:30 in Sao Paulo
    expect(isDue(instant.setZone("Europe/Lisbon"), 3, undefined)).toBe(false); // 07:30 in Lisbon
  });
});

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("daily generation job", () => {
  const prefix = `job-${Date.now()}`;
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  let studioId: string;

  beforeAll(async () => {
    ({ db, pool } = createDb());
    const [studio] = await db.insert(studios).values({ name: "Job test", slug: prefix, timezone: "America/Sao_Paulo" }).returning();
    studioId = studio.id;
    const slotIds: string[] = [];
    for (const weekday of [1, 2, 3, 4, 5]) {
      const [slot] = await db
        .insert(classSlots)
        .values({ studioId, name: `Day ${weekday}`, weekday, startTime: "07:00", durationMin: 60, capacity: 8, activeFrom: "2020-01-01" })
        .returning();
      slotIds.push(slot.id);
    }
    const [user] = await db.insert(users).values({ email: `${prefix}@example.com`, name: "Fixed", passwordHash: "x" }).returning();
    await db.insert(memberships).values({ studioId, userId: user.id, role: "student", status: "active" });
    const [student] = await db.insert(students).values({ studioId, userId: user.id }).returning();
    await db.insert(agreements).values({ studioId, studentId: student.id, weeklyLimit: 3, validFrom: "2020-01-01" });
    await db.insert(standingEnrollments).values({ studioId, studentId: student.id, slotId: slotIds[0], validFrom: "2020-01-01" });
  });

  afterAll(async () => {
    for (const table of ["bookings", "standing_enrollments", "agreements", "class_sessions", "class_slots", "students", "memberships"]) {
      await db.execute(sql.raw(`delete from ${table} where studio_id = '${studioId}'`));
    }
    await db.execute(sql`delete from users where email = ${prefix + "@example.com"}`);
    await db.execute(sql`delete from studios where id = ${studioId}`);
    await pool.end();
  });

  it("creates sessions and fixed-schedule bookings, and does nothing the second time", async () => {
    const first = await runGenerationForAllStudios(db, quiet, { studioIds: [studioId] });
    expect(first.skipped).toBe(false);
    expect(first.studios).toHaveLength(1);
    expect(first.studios[0].error).toBeUndefined();
    expect(first.studios[0].result!.sessionsCreated).toBeGreaterThanOrEqual(15);
    expect(first.studios[0].result!.standingBooked).toBeGreaterThanOrEqual(3);

    const second = await runGenerationForAllStudios(db, quiet, { studioIds: [studioId] });
    expect(second.studios[0].result).toMatchObject({ sessionsCreated: 0, standingBooked: 0 });

    const booked = await db.select().from(bookings).where(and(eq(bookings.studioId, studioId), eq(bookings.status, "booked")));
    const seats = await db.select({ n: sql<number>`sum(${classSessions.bookedCount})::int` }).from(classSessions).where(eq(classSessions.studioId, studioId));
    expect(seats[0].n).toBe(booked.length);
  });

  it("skips while another instance holds the lock, then runs once it is released", async () => {
    const other = await pool.connect();
    try {
      await other.query("select pg_advisory_lock(hashtext('dfit:generate-sessions'))");
      const blocked = await runGenerationForAllStudios(db, quiet, { studioIds: [studioId] });
      expect(blocked).toMatchObject({ skipped: true, studios: [] });
    } finally {
      await other.query("select pg_advisory_unlock(hashtext('dfit:generate-sessions'))");
      other.release();
    }
    const after = await runGenerationForAllStudios(db, quiet, { studioIds: [studioId] });
    expect(after.skipped).toBe(false);
  });

  it("lets only one of several simultaneous runs do the work", async () => {
    const runs = await Promise.all([1, 2, 3, 4].map(() => runGenerationForAllStudios(db, quiet, { studioIds: [studioId] })));
    expect(runs.filter((r) => !r.skipped).length).toBeGreaterThanOrEqual(1);
    const sessions = await db.select().from(classSessions).where(eq(classSessions.studioId, studioId));
    const unique = new Set(sessions.map((s) => `${s.slotId}|${s.startsAt.toISOString()}`));
    expect(unique.size).toBe(sessions.length);
  });
});
