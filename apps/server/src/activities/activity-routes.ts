import { Router } from "express";
import type { StudentScopedRequest } from "../auth/student-scope.js";
import { requireStudentActivityScope } from "../auth/student-scope.js";
import type { SessionService } from "../auth/session-auth.js";
import { ActivityLifecycleService } from "../services/activity-lifecycle.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { SnapshotService } from "../services/snapshot-service.js";
import { SubmissionService } from "../services/submission-service.js";

export function createTeacherActivityRouter(
  lifecycle: ActivityLifecycleService,
  closer: ActivityCloseService,
  snapshots: SnapshotService,
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
  return router;
}

export function createStudentActivityRouter(
  sessions: SessionService,
  snapshots: SnapshotService,
  submissions: SubmissionService,
): Router {
  const router = Router({ mergeParams: true });
  router.use(requireStudentActivityScope(sessions));
  router.get("/snapshot", (request, response, next) => {
    try {
      const scope = (request as StudentScopedRequest).studentScope;
      response.json(snapshots.student(scope.activityId, scope.groupId));
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
