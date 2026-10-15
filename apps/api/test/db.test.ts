import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, lt, sql } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client.js";
import {
  bookings,
  classSessions,
  classSlots,
  studios,
  students,
  users,
} from "../src/db/schema.js";

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("database rules", () => {
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  const slug = `test-${Date.now()}`;
  let studioId: string;
  let slotId: string;
  let studentIds: string[] = [];

  async function newSession(capacity: number) {
    const [row] = await db
      .insert(classSessions)
      .values({ studioId, slotId, startsAt: new Date(Date.now() + Math.random() * 1e9), capacity })
      .returning();
    return row;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb());
    const [studio] = await db
      .insert(studios)
      .values({ name: "Test studio", slug, timezone: "America/Sao_Paulo" })
      .returning();
    studioId = studio.id;
    const [slot] = await db
      .insert(classSlots)
      .values({
        studioId,
        name: "Morning",
        weekday: 1,
        startTime: "07:00",
        durationMin: 60,
        capacity: 10,
        activeFrom: "2026-01-01",
      })
      .returning();
    slotId = slot.id;
    for (let i = 0; i < 20; i++) {
      const [user] = await db
        .insert(users)
        .values({ email: `${slug}-${i}@example.com`, name: `Student ${i}`, passwordHash: "x" })
        .returning();
      const [student] = await db.insert(students).values({ studioId, userId: user.id }).returning();
      studentIds.push(student.id);
    }
  });

  afterAll(async () => {
    await db.execute(sql`delete from bookings where studio_id = ${studioId}`);
    await db.execute(sql`delete from class_sessions where studio_id = ${studioId}`);
    await db.execute(sql`delete from class_slots where studio_id = ${studioId}`);
    await db.execute(sql`delete from students where studio_id = ${studioId}`);
    await db.execute(sql`delete from users where email like ${slug + "-%"}`);
    await db.execute(sql`delete from studios where id = ${studioId}`);
    await pool.end();
  });

  it("rejects a seat count above capacity", async () => {
    const session = await newSession(2);
    await expect(
      db.update(classSessions).set({ bookedCount: 3 }).where(eq(classSessions.id, session.id)),
    ).rejects.toThrow();
  });

  it("rejects a weekday outside 1-7", async () => {
    await expect(
      db.insert(classSlots).values({
        studioId,
        name: "Bad",
        weekday: 8,
        startTime: "07:00",
        durationMin: 60,
        capacity: 10,
        activeFrom: "2026-01-01",
      }),
    ).rejects.toThrow();
  });

  it("blocks booking the same class twice for one student", async () => {
    const session = await newSession(5);
    const row = { studioId, sessionId: session.id, studentId: studentIds[0], source: "one_off" as const };
    await db.insert(bookings).values(row);
    await expect(db.insert(bookings).values(row)).rejects.toThrow();
  });

  it("lets a student rebook after cancelling", async () => {
    const session = await newSession(5);
    const row = { studioId, sessionId: session.id, studentId: studentIds[1], source: "one_off" as const };
    const [first] = await db.insert(bookings).values(row).returning();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.id));
    await expect(db.insert(bookings).values(row)).resolves.toBeDefined();
  });

  it("never oversells a class under simultaneous requests", async () => {
    const session = await newSession(5);
    const attempts = await Promise.all(
      studentIds.map((studentId) =>
        db.transaction(async (tx) => {
          const claimed = await tx
            .update(classSessions)
            .set({ bookedCount: sql`${classSessions.bookedCount} + 1` })
            .where(
              and(
                eq(classSessions.id, session.id),
                eq(classSessions.status, "scheduled"),
                lt(classSessions.bookedCount, classSessions.capacity),
              ),
            )
            .returning({ id: classSessions.id });
          if (claimed.length === 0) return false;
          await tx.insert(bookings).values({ studioId, sessionId: session.id, studentId, source: "one_off" });
          return true;
        }),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(5);
    const [after] = await db.select().from(classSessions).where(eq(classSessions.id, session.id));
    expect(after.bookedCount).toBe(5);
    const rows = await db.select().from(bookings).where(eq(bookings.sessionId, session.id));
    expect(rows).toHaveLength(5);
  });
});
