import { Router } from "express";
import type { StudentScopedRequest } from "../auth/student-scope.js";
import { requireStudentActivityScope } from "../auth/student-scope.js";
import type { SessionService } from "../auth/session-auth.js";
import { ActivityLifecycleService } from "../services/activity-lifecycle.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { SnapshotService } from "../services/snapshot-service.js";
import { SubmissionService } from "../services/submission-service.js";
import { ResultService } from "../services/result-service.js";
import type { GuidedNotesExportService } from "../guided-notes/export-service.js";

export function createTeacherActivityRouter(
  lifecycle: ActivityLifecycleService,
  closer: ActivityCloseService,
  snapshots: SnapshotService,
  results: ResultService,
  exports: GuidedNotesExportService,
): Router {
  const router = Router({ mergeParams: true });
  router.post("/open", (request, response, next) => {
    try {
      const activity = lifecycle.open((request.params as Record<string, string>).activityId!);
      response.json({ activityId: activity.id, state: activity.state, revision: activity.revision, openedAt: activity.openedAt });
    } catch (error) { next(error); }
  });
  router.post("/close", (request, response, next) => {
    try {
      response.json(closer.close((request.params as Record<string, string>).activityId!));
    } catch (error) { next(error); }
  });
  router.get("/snapshot", (request, response, next) => {
    try { response.json(snapshots.teacher((request.params as Record<string, string>).activityId!)); }
    catch (error) { next(error); }
  });
  router.get("/results", (request, response, next) => {
    try { response.json(results.teacher((request.params as Record<string, string>).activityId!)); }
    catch (error) { next(error); }
  });
  router.post("/exports", async (request, response, next) => {
    try {
      const exported = await exports.export((request.params as Record<string, string>).activityId!);
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
      response.setHeader("X-Export-Sha256", exported.sha256);
      response.send(exported.buffer);
    } catch (error) { next(error); }
  });
  return router;
}

export function createStudentActivityRouter(
  sessions: SessionService,
  snapshots: SnapshotService,
  submissions: SubmissionService,
  results: ResultService,
): Router {
  const router = Router({ mergeParams: true });
  router.use(requireStudentActivityScope(sessions));
  router.get("/snapshot", (request, response, next) => {
    try {
      const scope = (request as StudentScopedRequest).studentScope;
      response.json(snapshots.student(scope.activityId, scope.groupId));
    } catch (error) { next(error); }
  });
  router.get("/results", (request, response, next) => {
    try {
      const scope = (request as StudentScopedRequest).studentScope;
      response.json(results.student(scope.activityId, scope.groupId));
    } catch (error) { next(error); }
  });
  router.put("/questions/:questionId/submission", (request, response, next) => {
    try {
      const scoped = request as unknown as StudentScopedRequest;
      response.json(submissions.submit(scoped.authSession, {
        questionId: request.params.questionId!,
        answer: request.body?.answer,
        idempotencyKey: request.body?.idempotencyKey,
      }));
    } catch (error) { next(error); }
  });
  return router;
}
