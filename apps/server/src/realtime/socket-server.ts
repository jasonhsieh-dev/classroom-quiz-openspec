import type Database from "better-sqlite3";
import type { Server, Socket } from "socket.io";
import type {
  ActivityClosedEvent,
  ActivityOpenedEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  StudentSubmissionUpdatedEvent,
  TeacherSubmissionUpdatedEvent,
} from "@classroom-buzzer/shared";
import { SessionService } from "../auth/session-auth.js";
import { ActivityRepository, GroupRepository, type SessionRecord } from "../db/repositories/index.js";
import { AppError } from "../errors.js";
import type { CloseActivityResult } from "../services/activity-close.js";
import type { SubmissionCommittedEvent } from "../services/submission-service.js";

interface RealtimeSocketData {
  activityId: string;
  session: SessionRecord;
}

export type ClassroomSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  RealtimeSocketData
>;

function teacherRoom(activityId: string): string {
  return `activity:${activityId}:teacher`;
}

function groupRoom(activityId: string, groupId: string): string {
  return `activity:${activityId}:group:${groupId}`;
}

function socketError(error: unknown): Error {
  const appError = error instanceof AppError ? error : new AppError(401, "SOCKET_UNAUTHORIZED", "即時連線驗證失敗。");
  return Object.assign(new Error(appError.message), { data: { code: appError.code } });
}

export interface ActivityEventPublisher {
  opened(event: ActivityOpenedEvent): void;
  closed(event: ActivityClosedEvent): void;
  submission(event: SubmissionCommittedEvent): void;
}

export class SocketEventPublisher implements ActivityEventPublisher {
  private readonly groups: GroupRepository;

  constructor(
    private readonly io: ClassroomSocketServer,
    database: Database.Database,
  ) {
    this.groups = new GroupRepository(database);
  }

  opened(event: ActivityOpenedEvent): void {
    this.emitActivityState("activity.opened", event);
  }

  closed(event: ActivityClosedEvent): void {
    this.emitActivityState("activity.closed", event);
  }

  submission(event: SubmissionCommittedEvent): void {
    const teacherEvent: TeacherSubmissionUpdatedEvent = {
      activityId: event.activityId,
      questionId: event.questionId,
      groupId: event.groupId,
      answer: event.answer,
      serverReceivedAt: event.serverReceivedAt,
      revision: event.revision,
    };
    const studentEvent: StudentSubmissionUpdatedEvent = {
      activityId: event.activityId,
      questionId: event.questionId,
      answer: event.answer,
      serverReceivedAt: event.serverReceivedAt,
      revision: event.revision,
    };
    this.io.to(teacherRoom(event.activityId)).emit("submission.updated", teacherEvent);
    this.io.to(groupRoom(event.activityId, event.groupId)).emit("submission.updated", studentEvent);
  }

  private emitActivityState(
    name: "activity.opened" | "activity.closed",
    event: ActivityOpenedEvent | ActivityClosedEvent,
  ): void {
    this.io.to(teacherRoom(event.activityId)).emit(name, event as never);
    for (const group of this.groups.listByActivity(event.activityId)) {
      this.io.to(groupRoom(event.activityId, group.id)).emit(name, event as never);
    }
  }
}

export function configureSocketServer(
  io: ClassroomSocketServer,
  database: Database.Database,
  sessions: SessionService,
): SocketEventPublisher {
  const activities = new ActivityRepository(database);
  io.use((socket: Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, RealtimeSocketData>, next) => {
    try {
      const activityId = socket.handshake.auth.activityId;
      const usage = socket.handshake.auth.usage;
      if (typeof activityId !== "string" || !activityId.trim()) {
        throw new AppError(400, "ACTIVITY_ID_REQUIRED", "即時連線必須指定活動。");
      }
      if (usage !== "teacher" && usage !== "student") {
        throw new AppError(400, "SOCKET_USAGE_REQUIRED", "即時連線必須指定老師或學生用途。");
      }
      const activity = activities.findById(activityId);
      if (!activity) throw new AppError(404, "ACTIVITY_NOT_FOUND", "找不到指定活動。");
      const session = usage === "teacher"
        ? sessions.resolveTeacherCookieHeader(socket.handshake.headers.cookie)
        : sessions.resolveStudentCookieHeader(socket.handshake.headers.cookie);
      if (usage === "student" && (session.activityId !== activityId || !session.groupId)) {
        throw new AppError(403, "ACTIVITY_SCOPE_FORBIDDEN", "不得訂閱其他活動或組別的即時資料。");
      }
      socket.data = { activityId, session };
      next();
    } catch (error) {
      next(socketError(error));
    }
  });

  io.on("connection", (socket) => {
    const { activityId, session } = socket.data;
    void socket.join(session.role === "teacher"
      ? teacherRoom(activityId)
      : groupRoom(activityId, session.groupId!));
    socket.on("connection.ready", (acknowledge) => acknowledge({ ready: true }));
  });

  return new SocketEventPublisher(io, database);
}

export function openedEvent(activity: { id: string; revision: number }): ActivityOpenedEvent {
  return { activityId: activity.id, state: "OPEN", revision: activity.revision };
}

export function closedEvent(result: CloseActivityResult): ActivityClosedEvent {
  return { activityId: result.activityId, state: "CLOSED", revision: result.revision };
}
