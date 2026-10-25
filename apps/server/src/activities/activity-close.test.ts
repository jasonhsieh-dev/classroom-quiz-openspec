import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { SESSION_COOKIE_NAME, SessionService } from "../auth/session-auth.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import {
  ActivityRepository,
  GroupRepository,
  QuestionRepository,
  ResultRepository,
  SessionRepository,
  SubmissionRepository,
  type SessionRecord,
} from "../db/repositories/index.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { ActivityStateService } from "../services/activity-state.js";
import { SubmissionService } from "../services/submission-service.js";

const databases: TestDatabase[] = [];
const openedAt = "2026-10-24T02:00:00.000Z";
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });

function createDatabase(): TestDatabase {
  const database = createTestDatabase();
  databases.push(database);
  return database;
}

function addActivity(database: TestDatabase, id: string): void {
  new ActivityRepository(database.database).create({
    id,
    title: id,
    sourceFilePath: `${id}/source.xlsx`,
    sourceSha256: "synthetic",
    createdAt: openedAt,
  });
}

function addGroup(database: TestDatabase, activityId: string, id: string): void {
  new GroupRepository(database.database).create({ id, activityId, name: id, createdAt: openedAt });
}

function addQuestion(database: TestDatabase, activityId: string, id: string, sortOrder: number): void {
  new QuestionRepository(database.database).create({
    id,
    activityId,
    displayNumber: id,
    sortOrder,
    sheetName: "學習單",
    numberCell: `A${sortOrder + 2}`,
    answerRange: `B${sortOrder + 2}`,
    answerAnchor: `B${sortOrder + 2}`,
    originalAnswer: null,
  });
}

function addSession(
  database: TestDatabase,
  id: string,
  activityId: string,
  groupId: string,
  expiresAt = "2026-10-24T10:00:00.000Z",
): SessionRecord {
  return new SessionRepository(database.database).create({
    id,
    role: "student",
    activityId,
    groupId,
    createdAt: openedAt,
    expiresAt,
  });
}

function openFixture(database: TestDatabase): { s1: SessionRecord; s2: SessionRecord } {
  addActivity(database, "a1");
  addGroup(database, "a1", "g1");
  addGroup(database, "a1", "g2");
  addQuestion(database, "a1", "q1", 0);
  addQuestion(database, "a1", "q2", 1);
  addQuestion(database, "a1", "q3", 2);
  const s1 = addSession(database, "s1", "a1", "g1");
  const s2 = addSession(database, "s2", "a1", "g2");
  new ActivityStateService(database.database, () => openedAt).transition("a1", "OPEN");
  return { s1, s2 };
}

function cookie(id: string): string {
  return `${SESSION_COOKIE_NAME}=${id}`;
}

describe("活動截止與結果快照", () => {
  it("只以各題 current submission 的 receive_sequence 排名，忽略相同時間、舊歷程與其他活動", () => {
    const database = createDatabase();
    const { s1, s2 } = openFixture(database);
    const submissions = new SubmissionService(database.database, {
      clock: () => "2026-10-24T02:01:00.000Z",
    });
    submissions.submit(s1, { questionId: "q1", answer: "甲舊答案", idempotencyKey: "q1-g1-old" });
    submissions.submit(s2, { questionId: "q1", answer: "乙答案", idempotencyKey: "q1-g2" });
    submissions.submit(s2, { questionId: "q2", answer: "乙第二題", idempotencyKey: "q2-g2" });
    submissions.submit(s1, { questionId: "q1", answer: "甲新答案", idempotencyKey: "q1-g1-new" });

    addActivity(database, "a2");
    addGroup(database, "a2", "other-group");
    addQuestion(database, "a2", "other-question", 0);
    const otherSession = addSession(database, "other-session", "a2", "other-group");
    const otherAttempt = new SubmissionRepository(database.database).createAttempt({
      activityId: "a2",
      questionId: "other-question",
      groupId: "other-group",
      sessionId: otherSession.id,
      answer: "其他活動答案",
      serverReceivedAt: "2026-10-24T02:01:00.000Z",
      receiveSequence: 1,
      idempotencyKey: "other",
    });
    new SubmissionRepository(database.database).setCurrent(otherAttempt);

    const closed = new ActivityCloseService(
      database.database,
      () => "2026-10-24T03:00:00.000Z",
    ).close("a1");
    expect(closed).toEqual({
      activityId: "a1",
      state: "CLOSED",
      revision: 6,
      closedAt: "2026-10-24T03:00:00.000Z",
      resultCount: 3,
    });
    expect(new ResultRepository(database.database).listByActivity("a1")).toEqual([
      { activityId: "a1", questionId: "q1", groupId: "g2", attemptId: 2, rank: 1 },
      { activityId: "a1", questionId: "q1", groupId: "g1", attemptId: 4, rank: 2 },
      { activityId: "a1", questionId: "q2", groupId: "g2", attemptId: 3, rank: 1 },
    ]);
    expect(new ResultRepository(database.database).listByActivity("a2")).toEqual([]);
    expect(new ResultRepository(database.database).listByActivity("a1").some((entry) => entry.questionId === "q3")).toBe(false);
  });

  it("重複截止回傳既有 closed_at、revision 與結果，不再次呼叫截止時間", () => {
    const database = createDatabase();
    const { s1 } = openFixture(database);
    new SubmissionService(database.database).submit(s1, {
      questionId: "q1", answer: "答案", idempotencyKey: "answer",
    });
    let clockCalls = 0;
    const closer = new ActivityCloseService(database.database, () => {
      clockCalls += 1;
      return clockCalls === 1 ? "2026-10-24T03:00:00.000Z" : "2099-01-01T00:00:00.000Z";
    });
    const first = closer.close("a1");
    const firstEntries = new ResultRepository(database.database).listByActivity("a1");
    const second = closer.close("a1");
    expect(second).toEqual(first);
    expect(new ResultRepository(database.database).listByActivity("a1")).toEqual(firstEntries);
    expect(clockCalls).toBe(1);
  });

  it("相同 timestamp、時鐘倒退與修改都不反轉 receive_sequence 排名", () => {
    const database = createDatabase();
    const { s1, s2 } = openFixture(database);
    const times = [
      "2026-10-24T03:00:00.000Z",
      "2026-10-24T03:00:00.000Z",
      "2026-10-24T01:00:00.000Z",
    ];
    let index = 0;
    const submissions = new SubmissionService(database.database, {
      clock: () => times[index++]!,
    });
    submissions.submit(s1, { questionId: "q1", answer: "甲原答案", idempotencyKey: "g1-old" });
    submissions.submit(s2, { questionId: "q1", answer: "乙答案", idempotencyKey: "g2" });
    submissions.submit(s1, { questionId: "q1", answer: "甲修改答案", idempotencyKey: "g1-new" });

    expect(new SubmissionRepository(database.database).listAttemptsByActivity("a1").map((attempt) => ({
      answer: attempt.answer,
      serverReceivedAt: attempt.serverReceivedAt,
      receiveSequence: attempt.receiveSequence,
    }))).toEqual([
      { answer: "甲原答案", serverReceivedAt: times[0], receiveSequence: 1 },
      { answer: "乙答案", serverReceivedAt: times[1], receiveSequence: 2 },
      { answer: "甲修改答案", serverReceivedAt: times[2], receiveSequence: 3 },
    ]);

    new ActivityCloseService(database.database, () => "2026-10-24T04:00:00.000Z").close("a1");
    expect(new ResultRepository(database.database).listByActivity("a1").map(({ groupId, attemptId, rank }) => ({ groupId, attemptId, rank }))).toEqual([
      { groupId: "g2", attemptId: 2, rank: 1 },
      { groupId: "g1", attemptId: 3, rank: 2 },
    ]);
  });

  it("API 拒絕未登入、學生、過期老師與不存在活動，老師可截止且截止後新提交被拒絕", async () => {
    const database = createDatabase();
    openFixture(database);
    const sessions = new SessionRepository(database.database);
    sessions.create({ id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: openedAt, expiresAt: "2026-10-24T10:00:00.000Z" });
    sessions.create({ id: "expired-teacher", role: "teacher", activityId: null, groupId: null, createdAt: openedAt, expiresAt: "2026-10-24T01:00:00.000Z" });
    const sessionService = new SessionService(database.database, { now: () => new Date(openedAt) });
    const app = createApp({ registerRoutes(instance) {
      registerApplicationRoutes(instance, database.database, {
        data: join(database.directory, "data"),
        uploads: join(database.directory, "uploads"),
        exports: join(database.directory, "exports"),
      }, { sessions: sessionService });
    } });
    const closePath = "/api/teacher/activities/a1/close";
    await request(app).post(closePath).expect(401);
    await request(app).post(closePath).set("Cookie", cookie("s1")).expect(403);
    await request(app).post(closePath).set("Cookie", cookie("expired-teacher")).expect(401);
    await request(app).post("/api/teacher/activities/missing/close").set("Cookie", cookie("teacher")).expect(404);
    const first = await request(app).post(closePath).set("Cookie", cookie("teacher")).expect(200);
    const repeated = await request(app).post(closePath).set("Cookie", cookie("teacher")).expect(200);
    expect(repeated.body).toEqual(first.body);
    const rejected = await request(app)
      .put("/api/student/activities/a1/questions/q1/submission")
      .set("Cookie", cookie("s1"))
      .send({ answer: "太晚", idempotencyKey: "late" })
      .expect(409);
    expect(rejected.body.error.code).toBe("ACTIVITY_CLOSED");
    expect(new SubmissionRepository(database.database).listAttemptsByActivity("a1")).toEqual([]);
  });
});
