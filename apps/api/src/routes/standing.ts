import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/guard.js";
import { loadStudio } from "../booking/service.js";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  listEnrollments,
  listPendingRequests,
  listSlots,
  listStudentRequests,
  rejectRequest,
} from "../booking/standing.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { currentStudent } from "./bookings.js";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: uuid });
const note = z.string().trim().max(300).optional();

// Fixed classes: what a student sees and asks for, and what staff approve.
export function standingRoutes(config: Config, db: Db) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", authenticate(config));
    const studentOnly = requireRole("student");
    const staffOnly = requireRole("owner", "staff");

    // The weekly timetable a student can pick from when asking for a fixed class.
    app.get("/me/slots", { preHandler: studentOnly }, async (request) => listSlots(db, await loadStudio(db, request.auth!.studioId)));

    app.get("/me/standing-enrollments", { preHandler: studentOnly }, async (request) => {
      const auth = request.auth!;
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      return listEnrollments(db, studio, student.id);
    });

    app.get("/me/standing-requests", { preHandler: studentOnly }, async (request) => {
      const auth = request.auth!;
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      return listStudentRequests(db, studio, student.id);
    });

    app.post("/me/standing-requests", { preHandler: studentOnly }, async (request, reply) => {
      const auth = request.auth!;
      const body = z
        .object({ fromEnrollmentId: uuid.optional(), toSlotId: uuid.optional(), note })
        .refine((b) => b.fromEnrollmentId || b.toSlotId)
        .parse(request.body);
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      return reply.code(201).send({ request: await createRequest(db, studio, { studentId: student.id, ...body }) });
    });

    app.post("/me/standing-requests/:id/cancel", { preHandler: studentOnly }, async (request) => {
      const auth = request.auth!;
      const { id } = idParams.parse(request.params);
      const studio = await loadStudio(db, auth.studioId);
      const student = await currentStudent(db, auth);
      await cancelRequest(db, studio, student.id, id);
      return { ok: true };
    });

    app.get("/staff/standing-enrollments", { preHandler: staffOnly }, async (request) =>
      listEnrollments(db, await loadStudio(db, request.auth!.studioId)),
    );

    app.get("/staff/standing-requests", { preHandler: staffOnly }, async (request) =>
      listPendingRequests(db, await loadStudio(db, request.auth!.studioId)),
    );

    // allowOverCapacity: staff saw the "class is full" warning and accept one more student in it.
    app.post("/staff/standing-requests/:id/approve", { preHandler: staffOnly }, async (request) => {
      const auth = request.auth!;
      const { id } = idParams.parse(request.params);
      const body = z.object({ allowOverCapacity: z.boolean().optional(), effectiveFrom: isoDate.optional() }).parse(request.body ?? {});
      const studio = await loadStudio(db, auth.studioId);
      return approveRequest(db, studio, {
        requestId: id,
        decidedBy: auth.userId,
        allowOverCapacity: body.allowOverCapacity ?? false,
        effectiveFrom: body.effectiveFrom,
      });
    });

    app.post("/staff/standing-requests/:id/reject", { preHandler: staffOnly }, async (request) => {
      const auth = request.auth!;
      const { id } = idParams.parse(request.params);
      const body = z.object({ decisionNote: note }).parse(request.body ?? {});
      const studio = await loadStudio(db, auth.studioId);
      await rejectRequest(db, studio, { requestId: id, decidedBy: auth.userId, decisionNote: body.decisionNote });
      return { ok: true };
    });
  };
}
