import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import type { Role } from "@classroom-buzzer/shared";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import {
  ActivityRepository,
  GroupRepository,
  SessionRepository,
  type SessionRecord,
} from "../db/repositories/index.js";

export const SESSION_COOKIE_NAME = "classroom_buzzer_session";
export const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

interface SessionServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
  ttlMs?: number;
}

export interface AuthenticatedRequest extends Request {
  authSession: SessionRecord;
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class SessionService {
  private readonly sessions: SessionRepository;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  readonly ttlMs: number;

  constructor(
    private readonly database: Database.Database,
    options: SessionServiceOptions = {},
  ) {
    this.sessions = new SessionRepository(database);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  createTeacherSession(): SessionRecord {
    const createdAt = this.now();
    return this.sessions.create({
      id: this.idFactory(),
      role: "teacher",
      activityId: null,
      groupId: null,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
    });
  }

  createStudentSession(activityId: string, groupId: string): {
    session: SessionRecord;
    group: { id: string; name: string };
  } {
    const activity = new ActivityRepository(this.database).findById(activityId);
    const group = new GroupRepository(this.database).findById(groupId);
    if (!activity || !group || group.activityId !== activityId) {
      throw new AppError(404, "GROUP_NOT_AVAILABLE", "找不到此活動可選擇的組別。");
    }
    const createdAt = this.now();
    const session = this.sessions.create({
      id: this.idFactory(),
      role: "student",
      activityId,
      groupId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(),
    });
    return { session, group: { id: group.id, name: group.name } };
  }

  resolve(request: Request): SessionRecord {
    const id = cookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!id) {
      throw new AppError(401, "SESSION_REQUIRED", "需要有效的 session 才能存取此功能。");
    }
    const session = this.sessions.findById(id);
    if (!session) {
      throw new AppError(401, "SESSION_INVALID", "Session 無效，請重新進入系統。");
    }
    if (session.expiresAt <= this.now().toISOString()) {
      throw new AppError(401, "SESSION_EXPIRED", "Session 已過期，請重新進入系統。");
    }
    return session;
  }
}

export function requireRole(
  sessions: SessionService,
  role: Role,
): RequestHandler {
  return (request, _response, next) => {
    try {
      const session = sessions.resolve(request);
      if (session.role !== role) {
        throw new AppError(403, "ROLE_FORBIDDEN", "目前 session 無權存取此功能。");
      }
      (request as AuthenticatedRequest).authSession = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function sessionCookieOptions(secure: boolean, ttlMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: ttlMs,
  };
}
