import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityRepository, GroupRepository, QuestionRepository, SessionRepository } from "../db/repositories/index.js";
import { STUDENT_SESSION_COOKIE_NAME, SessionService } from "../auth/session-auth.js";

const databases: TestDatabase[] = [];
const now = "2026-10-24T02:00:00.000Z";
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  let sessionSequence = 0;
  const sessions = new SessionService(testDatabase.database, { now: () => new Date(now), idFactory: () => `session-${++sessionSequence}` });
  const app = createApp({ registerRoutes(instance) {
    registerApplicationRoutes(instance, testDatabase.database, {
      data: join(testDatabase.directory, "data"), uploads: join(testDatabase.directory, "uploads"), exports: join(testDatabase.directory, "exports"),
    }, { sessions });
  } });
  return { app, testDatabase };
}

function activity(db: TestDatabase, id: string) {
  return new ActivityRepository(db.database).create({ id, title: id, sourceFilePath: `${id}/source.xlsx`, sourceSha256: "sha", createdAt: now });
}
function group(db: TestDatabase, activityId: string, id: string) {
  return new GroupRepository(db.database).create({ id, activityId, name: id, createdAt: now });
}
function question(db: TestDatabase, activityId: string, id: string, sortOrder = 0, mapping = true, promptText: string | null = null) {
  return new QuestionRepository(db.database).create({
    id, activityId, displayNumber: id, sortOrder, promptText, promptRange: promptText ? `B${sortOrder + 2}` : null,
    sheetName: mapping ? "學習單" : "", numberCell: mapping ? `A${sortOrder + 2}` : "",
    answerRange: mapping ? `B${sortOrder + 2}` : "", answerAnchor: mapping ? `B${sortOrder + 2}` : "", originalAnswer: null,
  });
}
function cookie(id: string) { return `${STUDENT_SESSION_COOKIE_NAME}=${id}`; }

describe("活動開始與權威快照", () => {
  it("在單一交易中驗證並指出所有缺少的開始條件", async () => {
    const { app, testDatabase } = setup();
    activity(testDatabase, "empty");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);
    const empty = await teacher.post("/api/teacher/activities/empty/open").expect(409);
    expect(empty.body.error.details.missing).toEqual(["至少一題", "至少兩個組別"]);
    expect(new ActivityRepository(testDatabase.database).getById("empty").state).toBe("DRAFT");

    activity(testDatabase, "one-group"); group(testDatabase, "one-group", "one-g1"); question(testDatabase, "one-group", "one-q1");
    const oneGroup = await teacher.post("/api/teacher/activities/one-group/open").expect(409);
    expect(oneGroup.body.error.details.missing).toEqual(["至少兩個組別"]);

    activity(testDatabase, "bad-map"); group(testDatabase, "bad-map", "bad-g1"); group(testDatabase, "bad-map", "bad-g2"); question(testDatabase, "bad-map", "bad-q1", 0, false);
    const invalid = await teacher.post("/api/teacher/activities/bad-map/open").expect(409);
    expect(invalid.body.error.details.missing).toEqual(["有效的題目 mapping"]);
  });

  it("開始後一次向不同組別開放完整相同題號清單，沒有逐題鎖定資料", async () => {
    const { app, testDatabase } = setup();
    activity(testDatabase, "a1"); group(testDatabase, "a1", "g1"); group(testDatabase, "a1", "g2");
    question(testDatabase, "a1", "q1", 0); question(testDatabase, "a1", "q2", 1);
    const teacher = request.agent(app); await teacher.post("/api/teacher/session").expect(201);
    const opened = await teacher.post("/api/teacher/activities/a1/open").expect(200);
    expect(opened.body).toMatchObject({ activityId: "a1", state: "OPEN", revision: 1 });

    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "g1" }).expect(201);
    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "g2" }).expect(201);
    const sessions = new SessionRepository(testDatabase.database).listByActivity("a1");
    const snapshots = await Promise.all(sessions.map((session) => request(app).get("/api/student/activities/a1/snapshot").set("Cookie", cookie(session.id)).expect(200)));
    for (const snapshot of snapshots) {
      expect(snapshot.body.questions.map((item: { id: string }) => item.id)).toEqual(["q1", "q2"]);
      expect(snapshot.body.questions[0]).not.toHaveProperty("locked");
    }
    expect(snapshots[0]!.body.group.id).not.toBe(snapshots[1]!.body.group.id);
  });

  it("同時間最多一場 OPEN，第二場保留 DRAFT 並指出既有活動", async () => {
    const { app, testDatabase } = setup();
    for (const id of ["a1", "a2"]) {
      activity(testDatabase, id);
      group(testDatabase, id, `${id}-g1`);
      group(testDatabase, id, `${id}-g2`);
      question(testDatabase, id, `${id}-q`);
    }
    const teacher = request.agent(app); await teacher.post("/api/teacher/session").expect(201);
    await teacher.post("/api/teacher/activities/a1/open").expect(200);
    const blocked = await teacher.post("/api/teacher/activities/a2/open").expect(409);
    expect(blocked.body.error).toMatchObject({ code: "ANOTHER_ACTIVITY_OPEN", details: { activityId: "a1" } });
    expect(new ActivityRepository(testDatabase.database).getById("a2").state).toBe("DRAFT");
  });

  it("teacher snapshot 含全部組別資料；student snapshot 僅含 session 組別資料", async () => {
    const { app, testDatabase } = setup();
    activity(testDatabase, "a1"); group(testDatabase, "a1", "g1"); group(testDatabase, "a1", "g2"); question(testDatabase, "a1", "q1", 0, true, "請回答完整題目");
    const sessions = new SessionRepository(testDatabase.database);
    sessions.create({ id: "s1", role: "student", activityId: "a1", groupId: "g1", createdAt: now, expiresAt: "2026-10-24T10:00:00.000Z" });
    sessions.create({ id: "s2", role: "student", activityId: "a1", groupId: "g2", createdAt: now, expiresAt: "2026-10-24T10:00:00.000Z" });
    testDatabase.database.exec(`
      INSERT INTO submission_attempts (activity_id, question_id, group_id, session_id, answer, server_received_at, receive_sequence, idempotency_key)
      VALUES ('a1','q1','g1','s1','甲答案','2026-10-24T02:01:00.000Z',1,'k1'), ('a1','q1','g2','s2','乙答案','2026-10-24T02:02:00.000Z',2,'k2');
      INSERT INTO current_submissions (activity_id, question_id, group_id, attempt_id)
      SELECT activity_id, question_id, group_id, id FROM submission_attempts;
    `);
    const teacher = request.agent(app); await teacher.post("/api/teacher/session").expect(201);
    const teacherSnapshot = await teacher.get("/api/teacher/activities/a1/snapshot").expect(200);
    expect(teacherSnapshot.body).toMatchObject({ role: "teacher", title: "a1", revision: 0 });
    expect(teacherSnapshot.body.questions[0]).toMatchObject({ id: "q1", promptText: "請回答完整題目" });
    expect(teacherSnapshot.body.groups).toHaveLength(2);
    expect(teacherSnapshot.body.submissions.map((item: { answer: string }) => item.answer)).toEqual(["甲答案", "乙答案"]);

    const studentSnapshot = await request(app).get("/api/student/activities/a1/snapshot").set("Cookie", cookie("s1")).expect(200);
    expect(studentSnapshot.body).toMatchObject({ role: "student", group: { id: "g1" } });
    expect(studentSnapshot.body.questions[0]).toMatchObject({ id: "q1", promptText: "請回答完整題目" });
    expect(studentSnapshot.body.submissions).toEqual([{ questionId: "q1", answer: "甲答案", serverReceivedAt: "2026-10-24T02:01:00.000Z" }]);
    expect(JSON.stringify(studentSnapshot.body)).not.toContain("乙答案");
    expect(studentSnapshot.body.submissions[0]).not.toHaveProperty("groupId");
    expect(studentSnapshot.body).not.toHaveProperty("title");
  });

  it.each(["DRAFT", "OPEN", "CLOSED"] as const)("teacher snapshot 在 %s 狀態保留名稱、題目與 revision", async (state) => {
    const { app, testDatabase } = setup();
    activity(testDatabase, "recover");
    group(testDatabase, "recover", "g1");
    question(testDatabase, "recover", "q1", 0, true, "恢復後的完整題目");
    if (state !== "DRAFT") {
      testDatabase.database.prepare(
        "UPDATE activities SET state = ?, revision = ?, opened_at = ?, closed_at = ? WHERE id = ?",
      ).run(state, state === "OPEN" ? 2 : 4, now, state === "CLOSED" ? now : null, "recover");
    }
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);
    const snapshot = await teacher.get("/api/teacher/activities/recover/snapshot").expect(200);
    expect(snapshot.body).toMatchObject({
      activityId: "recover",
      title: "recover",
      state,
      revision: state === "DRAFT" ? 0 : state === "OPEN" ? 2 : 4,
      questions: [{ id: "q1", promptText: "恢復後的完整題目" }],
    });
    expect(snapshot.body.results === null).toBe(state !== "CLOSED");
  });
});
