import { Router } from "express";
import type { StudentSessionResponse } from "@classroom-buzzer/shared";
import type { SessionService } from "./session-auth.js";
import { sessionCookieOptions, STUDENT_SESSION_COOKIE_NAME } from "./session-auth.js";
import { AppError } from "../errors.js";

export function createStudentSessionRouter(sessions: SessionService): Router {
  const router = Router();
  router.post("/session", (request, response, next) => {
    try {
      const { activityId, groupId } = request.body ?? {};
      if (typeof activityId !== "string" || typeof groupId !== "string") {
        throw new AppError(400, "GROUP_SELECTION_REQUIRED", "請選擇有效的活動與組別。");
      }
      const created = sessions.createStudentSession(activityId, groupId);
      response.cookie(
        STUDENT_SESSION_COOKIE_NAME,
        created.session.id,
        sessionCookieOptions(request.secure, sessions.ttlMs),
      );
      const body: StudentSessionResponse = {
        role: "student",
        activityId,
        group: created.group,
        expiresAt: created.session.expiresAt,
      };
      response.status(201).json(body);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
