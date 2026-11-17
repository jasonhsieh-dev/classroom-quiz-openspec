import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import {
  ActivityRepository,
  GroupRepository,
  SessionRepository,
} from "../db/repositories/index.js";
import { setup as setupCloud, url as cloudUrl } from "../guided-notes/google-sheets-test-fixtures.js";
import { GoogleSheetsImportService } from "../guided-notes/google-sheets-import-service.js";
import {
  STUDENT_SESSION_COOKIE_NAME,
  TEACHER_SESSION_COOKIE_NAME,
  SessionService,
  sessionCookieOptions,
} from "./session-auth.js";
import {
  isLocalOrigin,
  isLoopbackAddress,
} from "./local-request-security.js";

const databases: TestDatabase[] = [];
const now = new Date("2026-10-23T02:00:00.000Z");

afterEach(() => {
  for (const item of databases.splice(0)) item.cleanup();
});

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const runtimePaths = {
    data: join(testDatabase.directory, "data"),
    uploads: join(testDatabase.directory, "uploads"),
    exports: join(testDatabase.directory, "exports"),
  };
  let sequence = 0;
  const sessions = new SessionService(testDatabase.database, {
    now: () => now,
    idFactory: () => `teacher-session-${++sequence}`,
  });
  const app = createApp({
    registerRoutes(instance) {
      registerApplicationRoutes(instance, testDatabase.database, runtimePaths, {
        sessions,
        googleSheetsReader: setupCloud().reader,
        googleSheetsImports: new GoogleSheetsImportService(testDatabase.database, setupCloud().reader, () => now),
      });
    },
  });
  return { app, testDatabase };
}

function cookie(id: string, role: "teacher" | "student" = "teacher"): string {
  const name = role === "teacher" ? TEACHER_SESSION_COOKIE_NAME : STUDENT_SESSION_COOKIE_NAME;
  return `${name}=${encodeURIComponent(id)}`;
}

function createStudentSession(testDatabase: TestDatabase, expiresAt: string) {
  const activities = new ActivityRepository(testDatabase.database);
  const groups = new GroupRepository(testDatabase.database);
  const sessions = new SessionRepository(testDatabase.database);
  activities.create({
    id: "student-activity",
    title: "學生測試活動",
    sourceFilePath: "student-activity/source.xlsx",
    sourceSha256: "synthetic-sha256",
    createdAt: now.toISOString(),
  });
  groups.create({
    id: "student-group",
    activityId: "student-activity",
    name: "測試組",
    createdAt: now.toISOString(),
  });
  sessions.create({
    id: "student-session",
    role: "student",
    activityId: "student-activity",
    groupId: "student-group",
    createdAt: now.toISOString(),
    expiresAt,
  });
}

async function upload(agent: ReturnType<typeof request.agent>) {
  return agent.post("/api/teacher/imports").send({ url: cloudUrl,sheetId: 0 });
}

describe("老師與學生 session 授權", () => {
  it("只將 loopback 位址與本機 HTTP(S) Origin 視為受控老師入口", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("https://127.0.0.1:3000")).toBe(true);
    expect(isLocalOrigin("https://evil.example")).toBe(false);
    expect(isLocalOrigin("not-a-url")).toBe(false);
  });

  it("由本機入口建立全域老師 session，忽略客戶端 role 並設定安全 Cookie 屬性", async () => {
    const { app, testDatabase } = setup();
    const response = await request(app)
      .post("/api/teacher/session")
      .set("Origin", "http://localhost:5173")
      .send({ role: "student", activityId: "forged" })
      .expect(201);

    expect(response.body).toMatchObject({ role: "teacher" });
    const setCookie = response.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toContain(`${TEACHER_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain("Secure");
    expect(
      testDatabase.database
        .prepare("SELECT role, activity_id, group_id FROM sessions")
        .get(),
    ).toEqual({ role: "teacher", activity_id: null, group_id: null });
    expect(sessionCookieOptions(true, 60_000)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60_000,
    });
  });

  it("拒絕跨網站老師入口，且不建立 session", async () => {
    const { app, testDatabase } = setup();
    await request(app)
      .post("/api/teacher/session")
      .set("Origin", "https://evil.example")
      .expect(403, {
        error: {
          code: "CSRF_REJECTED",
          message: "系統拒絕非本機來源的老師操作。",
        },
      });
    await request(app)
      .post("/api/teacher/session")
      .set("Sec-Fetch-Site", "cross-site")
      .expect(403);
    expect(
      testDatabase.database.prepare("SELECT COUNT(*) count FROM sessions").get(),
    ).toEqual({ count: 0 });
  });

  it("缺少、過期及學生 session 都無法存取老師端點", async () => {
    const { app, testDatabase } = setup();
    await request(app).post("/api/teacher/imports").expect(401);
    await request(app)
      .post("/api/teacher/imports")
      .set("Cookie", cookie("unknown-session"))
      .expect(401, {
        error: {
          code: "SESSION_INVALID",
          message: "Session 無效，請重新進入系統。",
        },
      });

    createStudentSession(testDatabase, "2026-10-23T03:00:00.000Z");
    await request(app)
      .post("/api/teacher/imports")
      .set("Cookie", cookie("student-session", "student"))
      .expect(401, {
        error: {
          code: "SESSION_REQUIRED",
          message: "需要有效的 session 才能存取此功能。",
        },
      });

    new SessionRepository(testDatabase.database).create({
      id: "expired-teacher",
      role: "teacher",
      activityId: null,
      groupId: null,
      createdAt: "2026-10-22T01:00:00.000Z",
      expiresAt: "2026-10-23T01:00:00.000Z",
    });
    await request(app)
      .post("/api/teacher/imports")
      .set("Cookie", cookie("expired-teacher"))
      .expect(401, {
        error: {
          code: "SESSION_EXPIRED",
          message: "Session 已過期，請重新進入系統。",
        },
      });
    expect(
      new SessionRepository(testDatabase.database).findById("expired-teacher"),
    ).toBeDefined();
  });

  it("三個 Guided Notes API 都拒絕未登入與學生，並允許老師操作", async () => {
    const { app, testDatabase } = setup();
    createStudentSession(testDatabase, "2026-10-23T03:00:00.000Z");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);

    await request(app).post("/api/teacher/imports").expect(401);
    await upload(
      request.agent(app).set("Cookie", cookie("student-session", "student")),
    ).then((response) => expect(response.status).toBe(401));

    const confirmDraft = await upload(teacher).then((response) => {
      expect(response.status).toBe(201);
      return response.body.importId as string;
    });
    await request(app)
      .post(`/api/teacher/imports/${confirmDraft}/confirm`)
      .send({ title: "未登入" })
      .expect(401);
    await request(app)
      .post(`/api/teacher/imports/${confirmDraft}/confirm`)
      .set("Cookie", cookie("student-session", "student"))
      .send({ title: "學生" })
      .expect(401);
    await teacher
      .post(`/api/teacher/imports/${confirmDraft}/confirm`)
      .send({ title: "老師建立活動" })
      .expect(201);

    const cancelDraft = await upload(teacher).then((response) => {
      expect(response.status).toBe(201);
      return response.body.importId as string;
    });
    await request(app)
      .delete(`/api/teacher/imports/${cancelDraft}`)
      .expect(401);
    await request(app)
      .delete(`/api/teacher/imports/${cancelDraft}`)
      .set("Cookie", cookie("student-session", "student"))
      .expect(401);
    await teacher.delete(`/api/teacher/imports/${cancelDraft}`).expect(204);
  });

  it("同一瀏覽器 agent 可依序建立老師與學生 session 並同時授權", async () => {
    const { app, testDatabase } = setup();
    createStudentSession(testDatabase, "2026-10-23T03:00:00.000Z");
    const browser = request.agent(app);

    const teacher = await browser.post("/api/teacher/session").expect(201);
    expect(teacher.headers["set-cookie"]?.[0]).toContain(`${TEACHER_SESSION_COOKIE_NAME}=`);
    expect(teacher.headers["set-cookie"]?.[0]).not.toContain(STUDENT_SESSION_COOKIE_NAME);

    const student = await browser.post("/api/student/session")
      .send({ activityId: "student-activity", groupId: "student-group" })
      .expect(201);
    expect(student.headers["set-cookie"]?.[0]).toContain(`${STUDENT_SESSION_COOKIE_NAME}=`);
    expect(student.headers["set-cookie"]?.[0]).not.toContain(TEACHER_SESSION_COOKIE_NAME);

    await upload(browser).then((response) => expect(response.status).toBe(201));
    await browser.get("/api/student/activities/student-activity/snapshot").expect(200);
  });

  it("HTTP middleware 只接受目標角色 cookie，並以繁體中文區分缺少與錯誤角色", async () => {
    const { app, testDatabase } = setup();
    createStudentSession(testDatabase, "2026-10-23T03:00:00.000Z");
    new SessionRepository(testDatabase.database).create({
      id: "teacher-session", role: "teacher", activityId: null, groupId: null,
      createdAt: now.toISOString(), expiresAt: "2026-10-23T03:00:00.000Z",
    });

    await request(app).post("/api/teacher/imports")
      .set("Cookie", cookie("student-session", "student"))
      .expect(401, { error: { code: "SESSION_REQUIRED", message: "需要有效的 session 才能存取此功能。" } });
    await request(app).post("/api/teacher/imports")
      .set("Cookie", cookie("student-session", "teacher"))
      .expect(403, { error: { code: "ROLE_FORBIDDEN", message: "目前 session 無權存取此功能。" } });

    await request(app).get("/api/student/activities/student-activity/snapshot")
      .set("Cookie", cookie("teacher-session", "teacher"))
      .expect(401, { error: { code: "SESSION_REQUIRED", message: "需要有效的 session 才能存取此功能。" } });
    await request(app).get("/api/student/activities/student-activity/snapshot")
      .set("Cookie", cookie("teacher-session", "student"))
      .expect(403, { error: { code: "ROLE_FORBIDDEN", message: "目前 session 無權存取此功能。" } });
  });
});
