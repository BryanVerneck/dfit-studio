import { and, eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { loadStudio } from "../booking/service.js";
import { localDate } from "../booking/time.js";
import { createDb } from "./client.js";
import { ensureTimetable } from "./seed-timetable.js";
import { agreements, memberships, students, studios, users } from "./schema.js";

// Local testing only: a timetable (7 classes, Monday to Friday) and an approved student with 3 classes a week.
// Run `db:seed` first. Safe to run more than once.
const email = "aluno@dfit.test";
const password = "senha1234";

const { db, pool } = createDb();
const [row] = await db.select().from(studios).where(eq(studios.slug, process.env.SEED_STUDIO_SLUG ?? "dfit"));
if (!row) throw new Error("Studio not found. Run db:seed first.");
const studio = await loadStudio(db, row.id);

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

const result = await ensureTimetable(db, studio.id);
await pool.end();
console.log(`Test student ready: ${email} / ${password}`, result);
