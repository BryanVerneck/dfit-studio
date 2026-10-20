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
  // How the student holds this seat: "standing" is the fixed schedule, "one_off" an avulsa class.
  myBookingSource?: "standing" | "one_off" | null;
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

export const swapBooking = (bookingId: string, toSessionId: string) =>
  authedRequest<{ booking: { id: string } }>(`/bookings/${bookingId}/swap`, "POST", { toSessionId, idempotencyKey: crypto.randomUUID() });

export interface MyBooking {
  id: string;
  sessionId: string;
  source: "standing" | "one_off";
  status: "booked" | "attended" | "no_show" | "cancelled";
  cancelReason: string | null;
  cancelNote: string | null;
  name: string;
  startsAt: string;
  durationMin: number;
}

// Defaults to the next four weeks.
export const fetchMyBookings = () => authedRequest<MyBooking[]>("/me/bookings");
