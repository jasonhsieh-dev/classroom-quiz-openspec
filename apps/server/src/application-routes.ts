import type { Express } from "express";
import type Database from "better-sqlite3";
import type { RuntimePaths } from "./config/runtime-paths.js";
import {
  protectLocalMutation,
  requireLoopbackRequest,
} from "./auth/local-request-security.js";
import { requireRole, SessionService } from "./auth/session-auth.js";
import { createTeacherSessionRouter } from "./auth/teacher-session-routes.js";
import { createStudentSessionRouter } from "./auth/student-session-routes.js";
import { createGuidedNotesImportRouter } from "./guided-notes/import-routes.js";
import { GuidedNotesImportService } from "./guided-notes/import-service.js";
import { createPublicActivityRouter, createTeacherGroupRouter } from "./groups/group-routes.js";
import { GroupService } from "./services/group-service.js";
import { createStudentActivityRouter, createTeacherActivityListRouter, createTeacherActivityRouter } from "./activities/activity-routes.js";
import { ActivityLifecycleService } from "./services/activity-lifecycle.js";
import { ActivityCloseService } from "./services/activity-close.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { SubmissionService } from "./services/submission-service.js";
import { ResultService } from "./services/result-service.js";
import type { ActivityEventPublisher } from "./realtime/socket-server.js";
import { closedEvent, openedEvent } from "./realtime/socket-server.js";
import { GuidedNotesExportService } from "./guided-notes/export-service.js";

interface ApplicationRouteServices {
  sessions?: SessionService;
  guidedNotesImports?: GuidedNotesImportService;
  submissions?: SubmissionService;
  events?: ActivityEventPublisher;
}

export function registerApplicationRoutes(
  app: Express,
  database: Database.Database,
  runtimePaths: RuntimePaths,
  services: ApplicationRouteServices = {},
): void {
  const sessions = services.sessions ?? new SessionService(database);
  const guidedNotesImports =
    services.guidedNotesImports ??
    new GuidedNotesImportService(database, runtimePaths);
  const submissions = services.submissions ?? new SubmissionService(database, {
    onCommitted: (event) => services.events?.submission(event),
  });

  app.use("/api/teacher", requireLoopbackRequest, protectLocalMutation);
  app.use("/api/teacher", createTeacherSessionRouter(sessions));
  app.use(
    "/api/teacher/imports",
    requireRole(sessions, "teacher"),
    createGuidedNotesImportRouter(guidedNotesImports),
  );
  app.use(
    "/api/teacher/activities",
    requireRole(sessions, "teacher"),
    createTeacherActivityListRouter(database),
  );
  app.use(
    "/api/teacher/activities/:activityId/groups",
    requireRole(sessions, "teacher"),
    createTeacherGroupRouter(new GroupService(database)),
  );
  app.use(
    "/api/teacher/activities/:activityId",
    requireRole(sessions, "teacher"),
    createTeacherActivityRouter(
      new ActivityLifecycleService(database, undefined, (activity) => services.events?.opened(openedEvent(activity))),
      new ActivityCloseService(database, undefined, (result) => services.events?.closed(closedEvent(result))),
      new SnapshotService(database),
      new ResultService(database),
      new GuidedNotesExportService(database, runtimePaths),
    ),
  );
  app.use("/api/activities", createPublicActivityRouter(database));
  app.use("/api/student", createStudentSessionRouter(sessions));
  app.use(
    "/api/student/activities/:activityId",
    createStudentActivityRouter(
      sessions,
      new SnapshotService(database),
      submissions,
      new ResultService(database),
    ),
  );
}
