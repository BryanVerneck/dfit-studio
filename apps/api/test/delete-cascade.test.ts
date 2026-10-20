import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  agreements,
  bookings,
  classSessions,
  classSlots,
  memberships,
  refreshTokens,
  standingEnrollments,
  standingRequests,
  studios,
  students,
  users,
} from "../src/db/schema.js";

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("deleting a user", () => {
  const prefix = `dc-${Date.now()}`;
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  const studioIds: string[] = [];

  beforeAll(() => {
    ({ db, pool } = createDb());
  });

  afterAll(async () => {
    for (const id of studioIds) {
      for (const table of ["standing_requests", "bookings", "standing_enrollments", "agreements", "class_sessions", "class_slots", "students", "refresh_tokens", "memberships"]) {
        await db.execute(sql.raw(`delete from ${table} where studio_id = '${id}'`));
      }
      await db.execute(sql.raw(`delete from studios where id = '${id}'`));
    }
    await db.execute(sql`delete from users where email like ${prefix + "-%"}`);
    await pool.end();
  });

  async function setup() {
    const [studio] = await db.insert(studios).values({ name: "dc", slug: `${prefix}-${studioIds.length}`, timezone: "America/Sao_Paulo" }).returning();
    studioIds.push(studio.id);
    const [slot] = await db
      .insert(classSlots)
      .values({ studioId: studio.id, name: "Slot", weekday: 1, startTime: "07:00", durationMin: 60, capacity: 5, activeFrom: "2020-01-01" })
      .returning();
    const [session] = await db
      .insert(classSessions)
      .values({ studioId: studio.id, slotId: slot.id, startsAt: new Date(Date.now() + 86_400_000), capacity: 5 })
      .returning();
    const person = async (label: string, role: "owner" | "student") => {
      const [user] = await db.insert(users).values({ email: `${prefix}-${label}@example.com`, name: label, passwordHash: "x" }).returning();
      await db.insert(memberships).values({ studioId: studio.id, userId: user.id, role, status: "active" });
      await db.insert(refreshTokens).values({ userId: user.id, studioId: studio.id, tokenHash: `${prefix}-${label}`, expiresAt: new Date(Date.now() + 1e9) });
      return user;
    };
    return { studio, slot, session, person };
  }

  it("removes a student's data and gives their seats back", async () => {
    const t = await setup();
    const staff = await t.person(`staff-${t.studio.slug}`, "owner");
    const ana = await t.person(`ana-${t.studio.slug}`, "student");
    const bia = await t.person(`bia-${t.studio.slug}`, "student");
    const [anaRow] = await db.insert(students).values({ studioId: t.studio.id, userId: ana.id }).returning();
    const [biaRow] = await db.insert(students).values({ studioId: t.studio.id, userId: bia.id }).returning();
    await db.insert(agreements).values({ studioId: t.studio.id, studentId: anaRow.id, weeklyLimit: 3, validFrom: "2020-01-01" });
    const [enrollment] = await db.insert(standingEnrollments).values({ studioId: t.studio.id, studentId: anaRow.id, slotId: t.slot.id, validFrom: "2020-01-01" }).returning();
    await db.insert(standingRequests).values({ studioId: t.studio.id, studentId: anaRow.id, fromEnrollmentId: enrollment.id, decidedBy: staff.id });
    // Ana holds a booking made by staff and one she cancelled; Bia holds one. Three bookings, two of them take a seat.
    const [first] = await db.insert(bookings).values({ studioId: t.studio.id, sessionId: t.session.id, studentId: anaRow.id, source: "standing", createdBy: staff.id }).returning();
    await db.insert(bookings).values({ studioId: t.studio.id, sessionId: t.session.id, studentId: anaRow.id, source: "one_off", status: "cancelled", replacesBookingId: first.id });
    await db.insert(bookings).values({ studioId: t.studio.id, sessionId: t.session.id, studentId: biaRow.id, source: "one_off" });
    await db.update(classSessions).set({ bookedCount: 2 }).where(eq(classSessions.id, t.session.id));

    await db.delete(users).where(eq(users.id, ana.id));

    expect(await db.select().from(students).where(eq(students.id, anaRow.id))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.userId, ana.id))).toHaveLength(0);
    expect(await db.select().from(refreshTokens).where(eq(refreshTokens.userId, ana.id))).toHaveLength(0);
    expect(await db.select().from(agreements).where(eq(agreements.studentId, anaRow.id))).toHaveLength(0);
    expect(await db.select().from(standingEnrollments).where(eq(standingEnrollments.studentId, anaRow.id))).toHaveLength(0);
    expect(await db.select().from(standingRequests).where(eq(standingRequests.studentId, anaRow.id))).toHaveLength(0);
    expect(await db.select().from(bookings).where(eq(bookings.studentId, anaRow.id))).toHaveLength(0);

    // Only the seat Ana actually held is given back; Bia keeps hers.
    const [session] = await db.select().from(classSessions).where(eq(classSessions.id, t.session.id));
    expect(session.bookedCount).toBe(1);
    expect(await db.select().from(bookings).where(eq(bookings.studentId, biaRow.id))).toHaveLength(1);
  });

  it("keeps bookings staff made for other students when staff are deleted", async () => {
    const t = await setup();
    const staff = await t.person(`staff-${t.studio.slug}`, "owner");
    const ana = await t.person(`ana-${t.studio.slug}`, "student");
    const [anaRow] = await db.insert(students).values({ studioId: t.studio.id, userId: ana.id }).returning();
    const [booking] = await db.insert(bookings).values({ studioId: t.studio.id, sessionId: t.session.id, studentId: anaRow.id, source: "one_off", createdBy: staff.id }).returning();
    await db.update(classSessions).set({ bookedCount: 1 }).where(eq(classSessions.id, t.session.id));

    await db.delete(users).where(eq(users.id, staff.id));

    const [kept] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(kept.createdBy).toBeNull();
    expect((await db.select().from(classSessions).where(eq(classSessions.id, t.session.id)))[0].bookedCount).toBe(1);
  });
});
