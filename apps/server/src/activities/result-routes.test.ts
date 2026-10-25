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
} from "../db/repositories/index.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { ActivityStateService } from "../services/activity-state.js";
import { SubmissionService } from "../services/submission-service.js";

const now = "2026-10-25T02:00:00.000Z";
const databases: TestDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.cleanup(); });

function cookie(id: string): string { return `${SESSION_COOKIE_NAME}=${id}`; }

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  const activities = new ActivityRepository(testDatabase.database);
  const groups = new GroupRepository(testDatabase.database);
  const questions = new QuestionRepository(testDatabase.database);
  const sessions = new SessionRepository(testDatabase.database);
  activities.create({ id: "a1", title: "結果測試", sourceFilePath: "a1/source.xlsx", sourceSha256: "synthetic", createdAt: now });
  groups.create({ id: "g1", activityId: "a1", name: "第一組", createdAt: now });
  groups.create({ id: "g2", activityId: "a1", name: "第二組", createdAt: now });
  for (const [index, id] of ["q1", "q2", "q3"].entries()) {
    questions.create({ id, activityId: "a1", displayNumber: String(index + 1), sortOrder: index, sheetName: "學習單", numberCell: `A${index + 2}`, answerRange: `B${index + 2}`, answerAnchor: `B${index + 2}`, originalAnswer: null });
  }
  const s1 = sessions.create({ id: "s1", role: "student", activityId: "a1", groupId: "g1", createdAt: now, expiresAt: "2026-10-25T10:00:00.000Z" });
  const s2 = sessions.create({ id: "s2", role: "student", activityId: "a1", groupId: "g2", createdAt: now, expiresAt: "2026-10-25T10:00:00.000Z" });
  sessions.create({ id: "teacher", role: "teacher", activityId: null, groupId: null, createdAt: now, expiresAt: "2026-10-25T10:00:00.000Z" });
  new ActivityStateService(testDatabase.database, () => now).transition("a1", "OPEN");
  const service = new SubmissionService(testDatabase.database, { clock: () => now });
  service.submit(s1, { questionId: "q1", answer: "第一名但內容錯誤", idempotencyKey: "g1-q1" });
  service.submit(s2, { questionId: "q1", answer: "第二組第一題", idempotencyKey: "g2-q1" });
  service.submit(s2, { questionId: "q2", answer: "第二組第二題", idempotencyKey: "g2-q2" });
  const sessionService = new SessionService(testDatabase.database, { now: () => new Date(now) });
  const app = createApp({ registerRoutes(instance) {
    registerApplicationRoutes(instance, testDatabase.database, {
      data: join(testDatabase.directory, "data"), uploads: join(testDatabase.directory, "uploads"), exports: join(testDatabase.directory, "exports"),
    }, { sessions: sessionService });
  } });
  return { app, testDatabase };
}

function close(database: TestDatabase): void {
  new ActivityCloseService(database.database, () => "2026-10-25T03:00:00.000Z").close("a1");
}

describe("截止結果 API 與角色裁切", () => {
  it("老師取得每題穩定完整順位，無人題目沒有虛構成功組別", async () => {
    const { app, testDatabase } = setup();
    close(testDatabase);
    const path = "/api/teacher/activities/a1/results";
    const first = await request(app).get(path).set("Cookie", cookie("teacher")).expect(200);
    const entriesBefore = new ResultRepository(testDatabase.database).listByActivity("a1");
    const second = await request(app).get(path).set("Cookie", cookie("teacher")).expect(200);
    expect(second.body).toEqual(first.body);
    expect(first.body.questions).toEqual([
      {
        question: { id: "q1", displayNumber: "1", sortOrder: 0 },
        winner: { id: "g1", name: "第一組" },
        rankings: [
          { group: { id: "g1", name: "第一組" }, rank: 1, answer: "第一名但內容錯誤", serverReceivedAt: now },
          { group: { id: "g2", name: "第二組" }, rank: 2, answer: "第二組第一題", serverReceivedAt: now },
        ],
      },
      {
        question: { id: "q2", displayNumber: "2", sortOrder: 1 },
        winner: { id: "g2", name: "第二組" },
        rankings: [{ group: { id: "g2", name: "第二組" }, rank: 1, answer: "第二組第二題", serverReceivedAt: now }],
      },
      { question: { id: "q3", displayNumber: "3", sortOrder: 2 }, winner: null, rankings: [] },
    ]);
    expect(new ResultRepository(testDatabase.database).listByActivity("a1")).toEqual(entriesBefore);
    const winnerEntry = entriesBefore.find((entry) => entry.questionId === "q1" && entry.rank === 1)!;
    expect(new SubmissionRepository(testDatabase.database).getAttempt(winnerEntry.attemptId).answer).toBe("第一名但內容錯誤");
  });

  it("學生 API 只回傳成功組別識別與本組答案順位，且忽略竄改 groupId", async () => {
    const { app, testDatabase } = setup();
    close(testDatabase);
    const firstGroup = await request(app).get("/api/student/activities/a1/results?groupId=g2").set("Cookie", cookie("s1")).expect(200);
    expect(firstGroup.body.group).toEqual({ id: "g1", name: "第一組" });
    expect(firstGroup.body.questions).toEqual([
      { question: { id: "q1", displayNumber: "1", sortOrder: 0 }, winner: { id: "g1", name: "第一組" }, ownResult: { status: "ANSWERED", answer: "第一名但內容錯誤", rank: 1 } },
      { question: { id: "q2", displayNumber: "2", sortOrder: 1 }, winner: { id: "g2", name: "第二組" }, ownResult: { status: "NOT_ANSWERED" } },
      { question: { id: "q3", displayNumber: "3", sortOrder: 2 }, winner: null, ownResult: { status: "NOT_ANSWERED" } },
    ]);
    const secondGroup = await request(app).get("/api/student/activities/a1/results").set("Cookie", cookie("s2")).expect(200);
    expect(secondGroup.body.questions[0]).toEqual({
      question: { id: "q1", displayNumber: "1", sortOrder: 0 },
      winner: { id: "g1", name: "第一組" },
      ownResult: { status: "ANSWERED", answer: "第二組第一題", rank: 2 },
    });
    const serialized = JSON.stringify(secondGroup.body);
    expect(serialized).not.toContain("第一名但內容錯誤");
    expect(serialized).not.toContain("serverReceivedAt");
    expect(serialized).not.toContain("rankings");
  });

  it("DRAFT/OPEN 不提供結果，且未登入或錯誤角色無法越權", async () => {
    const { app } = setup();
    const openSnapshot = await request(app).get("/api/student/activities/a1/snapshot").set("Cookie", cookie("s1")).expect(200);
    expect(openSnapshot.body.results).toBeNull();
    expect(JSON.stringify(openSnapshot.body)).not.toContain("winner");
    expect(JSON.stringify(openSnapshot.body)).not.toContain("rank");
    await request(app).get("/api/student/activities/a1/results").set("Cookie", cookie("s1")).expect(409);
    await request(app).get("/api/teacher/activities/a1/results").set("Cookie", cookie("teacher")).expect(409);
    await request(app).get("/api/teacher/activities/a1/results").expect(401);
    await request(app).get("/api/teacher/activities/a1/results").set("Cookie", cookie("s1")).expect(403);
    await request(app).get("/api/student/activities/a1/results").expect(401);
  });

  it("CLOSED snapshot 含角色裁切結果，重新整理不重新排名或洩漏其他組資料", async () => {
    const { app, testDatabase } = setup();
    close(testDatabase);
    const teacher = await request(app).get("/api/teacher/activities/a1/snapshot").set("Cookie", cookie("teacher")).expect(200);
    expect(teacher.body.state).toBe("CLOSED");
    expect(teacher.body.results.questions[0].rankings).toHaveLength(2);
    const student = await request(app).get("/api/student/activities/a1/snapshot").set("Cookie", cookie("s2")).expect(200);
    expect(student.body.state).toBe("CLOSED");
    expect(student.body.results.questions[0].ownResult).toEqual({ status: "ANSWERED", answer: "第二組第一題", rank: 2 });
    expect(JSON.stringify(student.body.results)).not.toContain("第一名但內容錯誤");
    expect(JSON.stringify(student.body.results)).not.toContain("serverReceivedAt");
  });
});
