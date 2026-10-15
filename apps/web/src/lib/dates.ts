import { STUDIO_TIMEZONE } from "../config";

// Days are handled as "YYYY-MM-DD" strings in the studio's time zone, so the phone's own time zone never shifts a class to another day.
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: STUDIO_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });

export const dayKey = (instant: Date | string) => dayFormat.format(new Date(instant));
export const formatTime = (instant: Date | string) => timeFormat.format(new Date(instant));

const toUtc = (key: string) => new Date(`${key}T00:00:00Z`);

export function addDays(key: string, days: number) {
  const d = toUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The calendar shows Sunday to Saturday. The weekly class limit still counts Monday to Sunday (decided by the server).
export function sundayOf(key: string) {
  return addDays(key, -toUtc(key).getUTCDay()); // 0 = Sunday
}

export const weekdayShort = (key: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" }).format(toUtc(key)).replace(".", "");

export const weekdayLong = (key: string) => {
  const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" }).format(toUtc(key));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const dayAndMonth = (key: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "numeric", month: "long" }).format(toUtc(key));
export const dayNumber = (key: string) => String(Number(key.slice(8)));
