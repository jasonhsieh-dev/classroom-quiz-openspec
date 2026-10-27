import { afterEach, describe, expect, it } from "vitest";
import { ActivityRepository, GroupRepository, SessionRepository } from "../db/repositories/index.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import {
  SessionService,
  STUDENT_SESSION_COOKIE_NAME,
  TEACHER_SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./session-auth.js";

const databases: TestDatabase[] = [];
const now = "2026-10-27T01:00:00.000Z";

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup();
});

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  new ActivityRepository(testDatabase.database).create({
    id: "a1", title: "測試活動", sourceFilePath: "a1/source.xlsx",
    sourceSha256: "synthetic", createdAt: now,
  });
  new GroupRepository(testDatabase.database).create({
    id: "g1", activityId: "a1", name: "第一組", createdAt: now,
  });
  const repository = new SessionRepository(testDatabase.database);
  repository.create({ id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: now, expiresAt: "2026-10-27T02:00:00.000Z" });
  repository.create({ id: "student", role: "student", activityId: "a1", groupId: "g1", createdAt: now, expiresAt: "2026-10-27T02:00:00.000Z" });
  repository.create({ id: "expired", role: "teacher", activityId: null, groupId: null, createdAt: now, expiresAt: "2026-10-27T00:59:59.000Z" });
  return new SessionService(testDatabase.database, { now: () => new Date(now) });
}

describe("角色專用 session cookie", () => {
  it("分別從老師與學生 cookie 解析，且兩者可同時存在", () => {
    const sessions = setup();
    const header = `${TEACHER_SESSION_COOKIE_NAME}=teacher; ${STUDENT_SESSION_COOKIE_NAME}=student`;
    expect(sessions.resolveTeacherCookieHeader(header).role).toBe("teacher");
    expect(sessions.resolveStudentCookieHeader(header).role).toBe("student");
  });

  it("缺少、無效、過期及錯誤角色皆回傳穩定授權錯誤", () => {
    const sessions = setup();
    expect(() => sessions.resolveTeacherCookieHeader(undefined)).toThrowError(expect.objectContaining({ status: 401, code: "SESSION_REQUIRED" }));
    expect(() => sessions.resolveTeacherCookieHeader(`${TEACHER_SESSION_COOKIE_NAME}=missing`)).toThrowError(expect.objectContaining({ status: 401, code: "SESSION_INVALID" }));
    expect(() => sessions.resolveTeacherCookieHeader(`${TEACHER_SESSION_COOKIE_NAME}=expired`)).toThrowError(expect.objectContaining({ status: 401, code: "SESSION_EXPIRED" }));
    expect(() => sessions.resolveTeacherCookieHeader(`${TEACHER_SESSION_COOKIE_NAME}=student`)).toThrowError(expect.objectContaining({ status: 403, code: "ROLE_FORBIDDEN" }));
    expect(() => sessions.resolveStudentCookieHeader(`${STUDENT_SESSION_COOKIE_NAME}=teacher`)).toThrowError(expect.objectContaining({ status: 403, code: "ROLE_FORBIDDEN" }));
  });

  it("Cookie 屬性固定為 HttpOnly、SameSite=Lax、根路徑並依 HTTPS 啟用 Secure", () => {
    expect(sessionCookieOptions(false, 60_000)).toEqual({
      httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60_000,
    });
    expect(sessionCookieOptions(true, 60_000)).toEqual({
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60_000,
    });
  });
});
