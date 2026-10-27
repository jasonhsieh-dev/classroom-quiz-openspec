import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { SessionService, TEACHER_SESSION_COOKIE_NAME } from "../auth/session-auth.js";
import { ActivityRepository, QuestionRepository } from "../db/repositories/index.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";

const databases: TestDatabase[] = [];
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const sessions = new SessionService(testDatabase.database, {
    now: () => new Date("2026-10-27T02:00:00.000Z"),
    idFactory: () => "teacher-summary-session",
  });
  const app = createApp({ registerRoutes(instance) {
    registerApplicationRoutes(instance, testDatabase.database, {
      data: join(testDatabase.directory, "data"),
      uploads: join(testDatabase.directory, "uploads"),
      exports: join(testDatabase.directory, "exports"),
    }, { sessions });
  } });
  return { app, testDatabase };
}

function addActivity(database: TestDatabase, id: string, createdAt: string, state: "DRAFT" | "OPEN" | "CLOSED") {
  new ActivityRepository(database.database).create({
    id,
    title: `${id} 標題`,
    sourceFilePath: `${id}/source.xlsx`,
    sourceSha256: "sha",
    createdAt,
  });
  new QuestionRepository(database.database).create({
    id: `${id}-q1`, activityId: id, displayNumber: "1", sortOrder: 0,
    sheetName: "學習單", numberCell: "A2", answerRange: "C2", answerAnchor: "C2", originalAnswer: null,
  });
  if (id === "closed") {
    new QuestionRepository(database.database).create({
      id: `${id}-q2`, activityId: id, displayNumber: "2", sortOrder: 1,
      sheetName: "學習單", numberCell: "A3", answerRange: "C3", answerAnchor: "C3", originalAnswer: null,
    });
  }
  if (state !== "DRAFT") {
    database.database.prepare(
      "UPDATE activities SET state = ?, revision = ?, opened_at = ?, closed_at = ? WHERE id = ?",
    ).run(state, state === "OPEN" ? 3 : 5, "2026-10-27T02:10:00.000Z", state === "CLOSED" ? "2026-10-27T02:20:00.000Z" : null, id);
  }
}

describe("老師 activity summary API", () => {
  it("要求有效老師 session，並回傳可顯示的繁體中文錯誤", async () => {
    const { app } = setup();
    const missing = await request(app).get("/api/teacher/activities").expect(401);
    expect(missing.body.error).toMatchObject({ code: "SESSION_REQUIRED", message: expect.stringContaining("session") });

    const invalid = await request(app)
      .get("/api/teacher/activities")
      .set("Cookie", `${TEACHER_SESSION_COOKIE_NAME}=missing`)
      .expect(401);
    expect(invalid.body.error).toMatchObject({ code: "SESSION_INVALID", message: expect.stringContaining("Session") });
  });

  it("最新優先列出唯一 OPEN 與所有 DRAFT/CLOSED 活動摘要", async () => {
    const { app, testDatabase } = setup();
    addActivity(testDatabase, "draft", "2026-10-27T01:00:00.000Z", "DRAFT");
    addActivity(testDatabase, "open", "2026-10-27T01:10:00.000Z", "OPEN");
    addActivity(testDatabase, "closed", "2026-10-27T01:20:00.000Z", "CLOSED");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);

    const response = await teacher.get("/api/teacher/activities").expect(200);
    expect(response.body.activities.map((item: { activityId: string }) => item.activityId)).toEqual(["closed", "open", "draft"]);
    expect(response.body.activities.filter((item: { state: string }) => item.state === "OPEN")).toHaveLength(1);
    expect(response.body.activities).toEqual([
      expect.objectContaining({ activityId: "closed", title: "closed 標題", state: "CLOSED", revision: 5, questionCount: 2, createdAt: "2026-10-27T01:20:00.000Z", openedAt: "2026-10-27T02:10:00.000Z", closedAt: "2026-10-27T02:20:00.000Z" }),
      expect.objectContaining({ activityId: "open", state: "OPEN", revision: 3, questionCount: 1 }),
      expect.objectContaining({ activityId: "draft", state: "DRAFT", revision: 0, questionCount: 1, openedAt: null, closedAt: null }),
    ]);
  });
});
