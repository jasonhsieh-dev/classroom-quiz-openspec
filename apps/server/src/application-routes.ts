import { GoogleSheetsWritebackService } from "./guided-notes/google-sheets-writeback-service.js";
import { createGoogleSheetsWritebackRouter } from "./guided-notes/google-sheets-writeback-routes.js";
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
import { createGoogleSheetsImportRouter } from "./guided-notes/google-sheets-import-routes.js";
import { GoogleSheetsReader } from "./guided-notes/google-sheets-reader.js";
import { GoogleSheetsImportService } from "./guided-notes/google-sheets-import-service.js";
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
  googleSheetsReader?: GoogleSheetsReader;
  googleSheetsWritebacks?: GoogleSheetsWritebackService;
  googleSheetsImports?: GoogleSheetsImportService;
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
  const reader = services.googleSheetsReader ?? new GoogleSheetsReader();
  const imports = services.googleSheetsImports ?? new GoogleSheetsImportService(database, reader);
  const submissions = services.submissions ?? new SubmissionService(database, {
    onCommitted: (event) => services.events?.submission(event),
  });

  app.use("/api/teacher", requireLoopbackRequest, protectLocalMutation);
  app.use("/api/teacher", createTeacherSessionRouter(sessions));
  app.use(
    "/api/teacher/imports",
    requireRole(sessions, "teacher"),
    createGoogleSheetsImportRouter(reader, imports),
  );
  app.use("/api/teacher/activities/:activityId/writeback",requireRole(sessions,"teacher"),
    createGoogleSheetsWritebackRouter(services.googleSheetsWritebacks ?? new GoogleSheetsWritebackService(database,reader)));
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
