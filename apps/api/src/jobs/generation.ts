import { inArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { generateSessions, loadStudio, type GenerationResult } from "../booking/service.js";
import type { Db } from "../db/client.js";
import { studios } from "../db/schema.js";

export interface JobLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface StudioRun {
  studioId: string;
  result?: GenerationResult;
  error?: string;
}

// Creates upcoming sessions and books fixed schedules for every studio. Safe to run at any time and
// from several server instances at once: only one holds the database lock, the others skip.
export async function runGenerationForAllStudios(db: Db, log: JobLogger, opts: { studioIds?: string[] } = {}) {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('dfit:generate-sessions')) as locked`);
    if (!(locked.rows[0] as { locked: boolean }).locked) {
      return { skipped: true, studios: [] as StudioRun[] };
    }

    const rows = await db
      .select({ id: studios.id })
      .from(studios)
      .where(opts.studioIds ? inArray(studios.id, opts.studioIds) : undefined);
    const runs: StudioRun[] = [];
    for (const { id } of rows) {
      try {
        const studio = await loadStudio(db, id);
        const result = await generateSessions(db, studio);
        runs.push({ studioId: id, result });
        log.info(
          { studioId: id, sessionsCreated: result.sessionsCreated, standingBooked: result.standingBooked, skipped: result.standingSkipped.length },
          "session generation finished",
        );
      } catch (err) {
        // One studio failing must not stop the others.
        runs.push({ studioId: id, error: err instanceof Error ? err.message : String(err) });
        log.error({ studioId: id, err }, "session generation failed");
      }
    }
    return { skipped: false, studios: runs };
  });
}

// True during the chosen local hour of the studio, once per local day.
export function isDue(nowInStudioZone: DateTime, hour: number, lastRunDate: string | undefined) {
  return nowInStudioZone.hour === hour && lastRunDate !== nowInStudioZone.toISODate();
}

// Runs once at startup to catch up after downtime, then checks every few minutes and generates for
// each studio during its own early-morning hour (studio time zone). Returns a function that stops it.
export function startGenerationScheduler(
  db: Db,
  log: JobLogger,
  opts: { hour?: number; tickMs?: number } = {},
) {
  const hour = opts.hour ?? 3;
  const lastRun = new Map<string, string>();

  async function tick(everyone: boolean) {
    const all = await db.select({ id: studios.id, timezone: studios.timezone }).from(studios);
    const due = all.filter((s) => {
      const now = DateTime.now().setZone(s.timezone);
      return everyone || isDue(now, hour, lastRun.get(s.id));
    });
    if (due.length === 0) return;
    const outcome = await runGenerationForAllStudios(db, log, { studioIds: due.map((s) => s.id) });
    if (outcome.skipped) return;
    for (const run of outcome.studios) {
      const tz = due.find((s) => s.id === run.studioId)!.timezone;
      // Failed studios are retried on the next tick while their hour lasts.
      if (!run.error) lastRun.set(run.studioId, DateTime.now().setZone(tz).toISODate()!);
    }
  }

  const safeTick = (everyone: boolean) =>
    tick(everyone).catch((err) => log.error({ err }, "session generation scheduler tick failed"));
  void safeTick(true);
  const timer = setInterval(() => void safeTick(false), opts.tickMs ?? 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
