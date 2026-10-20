import { eq } from "drizzle-orm";
import { generateSessions, loadStudio } from "../booking/service.js";
import { localDate } from "../booking/time.js";
import type { Db } from "./client.js";
import { classSlots } from "./schema.js";

export const DEFAULT_TIMES = ["06:00", "07:00", "08:00", "12:00", "17:00", "18:00", "19:00"];

// A weekly timetable (Monday to Friday) for a studio that has none yet, then the upcoming sessions.
// Does nothing when the studio already has class slots, so it is safe to run more than once.
export async function ensureTimetable(
  db: Db,
  studioId: string,
  opts: { times?: string[]; name?: string; capacity?: number; durationMin?: number } = {},
) {
  const studio = await loadStudio(db, studioId);
  const [existing] = await db.select({ id: classSlots.id }).from(classSlots).where(eq(classSlots.studioId, studio.id)).limit(1);
  let slotsCreated = 0;
  if (!existing) {
    const activeFrom = localDate(new Date(), studio.timezone);
    const rows = [1, 2, 3, 4, 5].flatMap((weekday) =>
      (opts.times ?? DEFAULT_TIMES).map((startTime) => ({
        studioId: studio.id,
        name: opts.name ?? "Treino",
        weekday,
        startTime,
        durationMin: opts.durationMin ?? 60,
        capacity: opts.capacity ?? 8,
        activeFrom,
      })),
    );
    await db.insert(classSlots).values(rows);
    slotsCreated = rows.length;
  }
  const generated = await generateSessions(db, studio);
  return { slotsCreated, ...generated };
}
