import { authedRequest } from "./api";

export interface ClassSession {
  id: string;
  slotId: string;
  name: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
  spotsLeft: number;
  status: "scheduled" | "cancelled" | "completed";
  cancelNote: string | null;
  myBookingId: string | null;
}

export interface WeeklyUsage {
  weekStart: string;
  used: number;
  weeklyLimit: number | null;
  remaining: number | null;
}

export const fetchSessions = (from: string, to: string) => authedRequest<ClassSession[]>(`/sessions?from=${from}&to=${to}`);
export const fetchUsage = (date: string) => authedRequest<WeeklyUsage>(`/me/weekly-usage?date=${date}`);

// One key per click, so a retry after a dropped connection can never book twice.
export const bookClass = (sessionId: string) =>
  authedRequest<{ booking: { id: string } }>("/bookings", "POST", { sessionId, idempotencyKey: crypto.randomUUID() });

export const cancelBooking = (bookingId: string) => authedRequest<{ booking: { id: string } }>(`/bookings/${bookingId}`, "DELETE");
