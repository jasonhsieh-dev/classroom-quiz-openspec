import type { Request, RequestHandler } from "express";
import { AppError } from "../errors.js";
import type { SessionRecord } from "../db/repositories/index.js";
import type { SessionService } from "./session-auth.js";

export interface StudentScopedRequest extends Request {
  authSession: SessionRecord;
  studentScope: { activityId: string; groupId: string };
}

export function requireStudentActivityScope(sessions: SessionService): RequestHandler {
  return (request, _response, next) => {
    try {
      const session = sessions.resolveStudent(request);
      if (!session.activityId || !session.groupId) {
        throw new AppError(403, "ROLE_FORBIDDEN", "目前 session 無權存取學生功能。");
      }
      if (request.params.activityId !== session.activityId) {
        throw new AppError(403, "ACTIVITY_SCOPE_FORBIDDEN", "不得存取其他活動或組別的資料。");
      }
      const scoped = request as StudentScopedRequest;
      scoped.authSession = session;
      scoped.studentScope = { activityId: session.activityId, groupId: session.groupId };
      next();
    } catch (error) {
      next(error);
    }
  };
}
