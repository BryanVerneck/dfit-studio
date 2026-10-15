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
