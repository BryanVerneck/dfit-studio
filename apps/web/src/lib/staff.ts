import { authedRequest } from "./api";

export interface PendingStudent {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  requestedAt: string;
}

export const fetchPendingStudents = () => authedRequest<PendingStudent[]>("/staff/pending-students");

// Approving creates the student; the weekly limit is a separate agreement on that student.
export async function approveStudent(userId: string, weeklyLimit: number) {
  const { studentId } = await authedRequest<{ studentId: string }>(`/staff/students/${userId}/approve`, "POST");
  await authedRequest(`/staff/students/${studentId}/agreement`, "POST", { weeklyLimit });
}

export interface NewStudent {
  name: string;
  email: string;
  phone?: string;
  weeklyLimit: number;
}

// Creates an active student with a temporary password (shown once) that must be replaced at the first login.
export const createStudent = (student: NewStudent) =>
  authedRequest<{ userId: string; studentId: string; temporaryPassword: string }>("/staff/students", "POST", student);

export interface StudentRow {
  studentId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  weeklyLimit: number | null;
}

export const fetchStudents = () => authedRequest<StudentRow[]>("/staff/students");

// removedFixedClasses: how many fixed classes were taken away because the new limit is lower than the number held.
export const setWeeklyLimit = (studentId: string, weeklyLimit: number) =>
  authedRequest<{ removedFixedClasses?: number }>(`/staff/students/${studentId}/agreement`, "POST", { weeklyLimit });

// The server shows the password only in this response; it is never stored in readable form.
export const createTemporaryPassword = (userId: string) =>
  authedRequest<{ temporaryPassword: string }>(`/staff/users/${userId}/temporary-password`, "POST");

export interface ClassDetail {
  session: { id: string; name: string; startsAt: string; capacity: number; bookedCount: number; status: "scheduled" | "cancelled" | "completed" };
  roster: { bookingId: string; studentId: string; name: string; phone: string | null; source: "standing" | "one_off" }[];
}

export const fetchClassDetail = (sessionId: string) => authedRequest<ClassDetail>(`/staff/sessions/${sessionId}/roster`);

export const addStudentToClass = (sessionId: string, studentId: string) =>
  authedRequest<{ booking: { id: string } }>("/staff/bookings", "POST", { sessionId, studentId });

export const removeBooking = (bookingId: string) => authedRequest<{ booking: { id: string } }>(`/bookings/${bookingId}`, "DELETE");

export interface CancelledClass {
  bookingsCancelled: number;
  affected: { studentId: string; name: string; phone: string | null }[];
}

// Calls off one class. The answer lists the students who had a seat, so the studio can tell them.
export const cancelClass = (sessionId: string, note?: string) =>
  authedRequest<CancelledClass>(`/staff/sessions/${sessionId}/cancel`, "POST", note ? { note } : {});
