import { DateTime } from "luxon";

export const localDate = (instant: Date, timezone: string) =>
  DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!;

// The booking week runs Monday 00:00 to the next Monday 00:00 in the studio's time zone.
export function weekBounds(instant: Date, timezone: string) {
  const start = DateTime.fromJSDate(instant, { zone: timezone }).startOf("week");
  return { start: start.toJSDate(), end: start.plus({ weeks: 1 }).toJSDate(), startDate: start.toISODate()! };
}

export function dayRange(from: string, toInclusive: string, timezone: string) {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf("day");
  const end = DateTime.fromISO(toInclusive, { zone: timezone }).plus({ days: 1 }).startOf("day");
  return { start: start.toJSDate(), end: end.toJSDate(), valid: start.isValid && end.isValid };
}
