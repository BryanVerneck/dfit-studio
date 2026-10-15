import { and, eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { generateSessions, loadStudio } from "../booking/service.js";
import { localDate } from "../booking/time.js";
import { createDb } from "./client.js";
import { agreements, classSlots, memberships, students, studios, users } from "./schema.js";

// Local testing only: a timetable (7 classes, Monday to Friday) and an approved student with 3 classes a week.
// Run `db:seed` first. Safe to run more than once.
const email = "aluno@dfit.test";
const password = "senha1234";
const times = ["06:00", "07:00", "08:00", "12:00", "17:00", "18:00", "19:00"];

const { db, pool } = createDb();
const [row] = await db.select().from(studios).where(eq(studios.slug, process.env.SEED_STUDIO_SLUG ?? "dfit"));
if (!row) throw new Error("Studio not found. Run db:seed first.");
const studio = await loadStudio(db, row.id);

const [existingSlot] = await db.select({ id: classSlots.id }).from(classSlots).where(eq(classSlots.studioId, studio.id)).limit(1);
if (!existingSlot) {
  const activeFrom = localDate(new Date(), studio.timezone);
  await db.insert(classSlots).values(
    [1, 2, 3, 4, 5].flatMap((weekday) =>
      times.map((startTime) => ({ studioId: studio.id, name: "Treino", weekday, startTime, durationMin: 60, capacity: 8, activeFrom })),
    ),
  );
}

await db
  .insert(users)
  .values({ email, name: "Aluno Teste", passwordHash: await hashPassword(password) })
  .onConflictDoNothing({ target: users.email });
const [user] = await db.select().from(users).where(eq(users.email, email));
await db.insert(memberships).values({ studioId: studio.id, userId: user.id, role: "student", status: "active" }).onConflictDoNothing();
await db.insert(students).values({ studioId: studio.id, userId: user.id }).onConflictDoNothing();
const [student] = await db.select().from(students).where(and(eq(students.studioId, studio.id), eq(students.userId, user.id)));
const [agreement] = await db.select({ id: agreements.id }).from(agreements).where(eq(agreements.studentId, student.id)).limit(1);
if (!agreement) {
  await db.insert(agreements).values({ studioId: studio.id, studentId: student.id, weeklyLimit: 3, validFrom: localDate(new Date(), studio.timezone) });
}

const result = await generateSessions(db, studio);
await pool.end();
console.log(`Test student ready: ${email} / ${password}`, result);
