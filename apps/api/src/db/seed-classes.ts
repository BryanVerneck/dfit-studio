import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { studios } from "./schema.js";
import { ensureTimetable } from "./seed-timetable.js";

// Gives the studio a Monday to Friday timetable when it has none. Runs only when SEED_DEFAULT_TIMETABLE=true,
// so a normal start never touches classes. Optional: SEED_CLASS_TIMES="06:00,07:00", SEED_CLASS_CAPACITY=8,
// SEED_CLASS_NAME=Treino. Run `db:seed` first.
if (process.env.SEED_DEFAULT_TIMETABLE !== "true") {
  console.log("Timetable seed skipped (SEED_DEFAULT_TIMETABLE is not true)");
  process.exit(0);
}

const { db, pool } = createDb();
const [studio] = await db.select().from(studios).where(eq(studios.slug, process.env.SEED_STUDIO_SLUG ?? "dfit"));
if (!studio) throw new Error("Studio not found. Run db:seed first.");

const times = process.env.SEED_CLASS_TIMES?.split(",").map((t) => t.trim()).filter(Boolean);
const result = await ensureTimetable(db, studio.id, {
  times,
  name: process.env.SEED_CLASS_NAME,
  capacity: process.env.SEED_CLASS_CAPACITY ? Number(process.env.SEED_CLASS_CAPACITY) : undefined,
});
await pool.end();
console.log("Timetable ready", result);
