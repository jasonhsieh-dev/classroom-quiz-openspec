import { Router } from "express";
import type { TeacherSessionResponse } from "@classroom-buzzer/shared";
import {
  TEACHER_SESSION_COOKIE_NAME,
  SessionService,
  sessionCookieOptions,
} from "./session-auth.js";

export function createTeacherSessionRouter(sessions: SessionService): Router {
  const router = Router();

  router.post("/session", (request, response, next) => {
    try {
      const session = sessions.createTeacherSession();
      response.cookie(
        TEACHER_SESSION_COOKIE_NAME,
        session.id,
        sessionCookieOptions(request.secure, sessions.ttlMs),
      );
      const body: TeacherSessionResponse = {
        role: "teacher",
        expiresAt: session.expiresAt,
      };
      response.status(201).json(body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
