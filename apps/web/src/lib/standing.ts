import { authedRequest } from "./api";

export interface Slot {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  durationMin: number;
}

// A fixed class of one student. validTo is set once an end was approved: the class still runs until that day.
export interface FixedClass extends Slot {
  id: string;
  studentId: string;
  slotId: string;
  validFrom: string;
  validTo: string | null;
}

export interface SlotInfo {
  slotId: string;
  enrollmentId: string | null;
  name: string;
  weekday: number;
  startTime: string;
  durationMin: number;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface StandingRequest {
  id: string;
  studentId: string;
  status: RequestStatus;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  from: SlotInfo | null;
  to: SlotInfo | null;
}

export interface CapacityPreview {
  capacity: number;
  nextBooked: number;
  fullSessions: number;
  totalSessions: number;
}

export interface PendingRequest extends StandingRequest {
  studentName: string;
  studentPhone: string | null;
  capacity: CapacityPreview | null;
}

const WEEKDAYS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

// "Segunda 07:00" (the database sends times as 07:00:00).
export const slotLabel = (slot: { weekday: number; startTime: string }) => `${WEEKDAYS[slot.weekday]} ${slot.startTime.slice(0, 5)}`;

export const slotOptions = (slots: Slot[], skip: string[] = []) =>
  slots.filter((s) => !skip.includes(s.id)).map((s) => ({ value: s.id, label: `${slotLabel(s)} · ${s.name}` }));

export function describeRequest(r: Pick<StandingRequest, "from" | "to">) {
  if (r.from && r.to) return `Trocar ${slotLabel(r.from)} por ${slotLabel(r.to)}`;
  if (r.to) return `Entrar na turma de ${slotLabel(r.to)}`;
  return r.from ? `Sair da turma de ${slotLabel(r.from)}` : "";
}

// Student side
export const fetchSlots = () => authedRequest<Slot[]>("/me/slots");
export const fetchMyFixed = () => authedRequest<FixedClass[]>("/me/standing-enrollments");
export const fetchMyRequests = () => authedRequest<StandingRequest[]>("/me/standing-requests");
export const askForChange = (body: { fromEnrollmentId?: string; toSlotId?: string; note?: string }) =>
  authedRequest<{ request: StandingRequest }>("/me/standing-requests", "POST", body);
export const withdrawRequest = (id: string) => authedRequest(`/me/standing-requests/${id}/cancel`, "POST");

// Staff side
export const fetchPendingRequests = () => authedRequest<PendingRequest[]>("/staff/standing-requests");
export const approveRequest = (id: string, allowOverCapacity: boolean) =>
  authedRequest<{ effectiveFrom: string; overbooked: number; skipped: { reason: string }[] }>(
    `/staff/standing-requests/${id}/approve`,
    "POST",
    { allowOverCapacity },
  );
export const rejectRequest = (id: string, decisionNote?: string) =>
  authedRequest(`/staff/standing-requests/${id}/reject`, "POST", decisionNote ? { decisionNote } : {});
export const fetchSlotsForStaff = () => authedRequest<Slot[]>("/staff/slots");
export const fetchAllFixed = () => authedRequest<FixedClass[]>("/staff/standing-enrollments");
export const addFixedClass = (studentId: string, slotId: string, allowOverCapacity = false) =>
  authedRequest(`/staff/students/${studentId}/standing-enrollments`, "POST", { slotId, allowOverCapacity });
// Ends now: the classes still to come are cancelled at once. Classes that already started are kept.
export const endFixedClass = (enrollmentId: string) => authedRequest(`/staff/standing-enrollments/${enrollmentId}/end`, "POST", {});
