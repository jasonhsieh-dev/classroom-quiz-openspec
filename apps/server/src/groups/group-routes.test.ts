import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityRepository, GroupRepository, SessionRepository } from "../db/repositories/index.js";
import { ActivityStateService } from "../services/activity-state.js";
import { STUDENT_SESSION_COOKIE_NAME, TEACHER_SESSION_COOKIE_NAME, SessionService } from "../auth/session-auth.js";
import { requireStudentActivityScope, type StudentScopedRequest } from "../auth/student-scope.js";

const databases: TestDatabase[] = [];
const now = "2026-10-24T01:00:00.000Z";

afterEach(() => {
  for (const item of databases.splice(0)) item.cleanup();
});

function setup() {
  const testDatabase = createTestDatabase();
  databases.push(testDatabase);
  let ids = 0;
  const sessions = new SessionService(testDatabase.database, {
    now: () => new Date(now),
    idFactory: () => `session-${++ids}`,
  });
  const app = createApp({
    registerRoutes(instance) {
      registerApplicationRoutes(
        instance,
        testDatabase.database,
        {
          data: join(testDatabase.directory, "data"),
          uploads: join(testDatabase.directory, "uploads"),
          exports: join(testDatabase.directory, "exports"),
        },
        { sessions },
      );
      instance.get(
        "/test/student/:activityId/private",
        requireStudentActivityScope(sessions),
        (req, res) => res.json((req as StudentScopedRequest).studentScope),
      );
    },
  });
  return { app, testDatabase };
}

function createActivity(testDatabase: TestDatabase, id: string) {
  return new ActivityRepository(testDatabase.database).create({
    id,
    title: id,
    sourceFilePath: `${id}/source.xlsx`,
    sourceSha256: "synthetic",
    createdAt: now,
  });
}

function cookie(id: string) {
  return `${STUDENT_SESSION_COOKIE_NAME}=${id}`;
}

describe("活動組別與學生選組", () => {
  it("老師可在 DRAFT 新增、正規化、重新命名及刪除組別", async () => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "a1");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);

    const created = await teacher
      .post("/api/teacher/activities/a1/groups")
      .send({ name: "  第一組  " })
      .expect(201);
    expect(created.body.name).toBe("第一組");
    await teacher
      .post("/api/teacher/activities/a1/groups")
      .send({ name: "第一組" })
      .expect(409);
    await teacher
      .post("/api/teacher/activities/a1/groups")
      .send({ name: "　 " })
      .expect(400);

    await teacher
      .patch(`/api/teacher/activities/a1/groups/${created.body.id}`)
      .send({ name: "甲組" })
      .expect(200, { id: created.body.id, name: "甲組" });
    await teacher
      .delete(`/api/teacher/activities/a1/groups/${created.body.id}`)
      .expect(204);
    expect(new GroupRepository(testDatabase.database).listByActivity("a1")).toEqual([]);
    expect(new ActivityRepository(testDatabase.database).getById("a1").revision).toBe(3);
  });

  it("老師可依數量建立及重設完整清單，重複操作不會累加組別", async () => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "batch");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);

    const first = await teacher.put("/api/teacher/activities/batch/groups")
      .send({ count: 6 }).expect(200);
    expect(first.body).toMatchObject({ activityId: "batch", state: "DRAFT", revision: 1 });
    expect(first.body.groups.map((group: { name: string }) => group.name)).toEqual([
      "第 1 組", "第 2 組", "第 3 組", "第 4 組", "第 5 組", "第 6 組",
    ]);

    const repeated = await teacher.put("/api/teacher/activities/batch/groups")
      .send({ count: 6 }).expect(200);
    expect(repeated.body.groups).toHaveLength(6);
    expect(repeated.body.revision).toBe(2);
    expect(new GroupRepository(testDatabase.database).listByActivity("batch")).toHaveLength(6);
  });

  it("批次 API 拒絕非整數、0、101、錯誤角色與已有學生 session", async () => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "batch");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);
    for (const count of ["6", 1.5, 0, 101]) {
      await teacher.put("/api/teacher/activities/batch/groups")
        .send({ count }).expect(400, {
          error: { code: "GROUP_COUNT_INVALID", message: "組別數量必須是 1 至 100 的整數。" },
        });
    }
    expect(new GroupRepository(testDatabase.database).listByActivity("batch")).toEqual([]);

    const groups = new GroupRepository(testDatabase.database);
    groups.create({ id: "g1", activityId: "batch", name: "既有組別", createdAt: now });
    new SessionRepository(testDatabase.database).create({
      id: "student", role: "student", activityId: "batch", groupId: "g1",
      createdAt: now, expiresAt: "2026-10-24T09:00:00.000Z",
    });
    await request(app).put("/api/teacher/activities/batch/groups")
      .set("Cookie", `${TEACHER_SESSION_COOKIE_NAME}=student`)
      .send({ count: 2 }).expect(403);
    await teacher.put("/api/teacher/activities/batch/groups")
      .send({ count: 2 }).expect(409, {
        error: {
          code: "GROUPS_IN_USE",
          message: "已有學生選擇組別，為避免破壞 session 綁定，不能重新產生組別。",
        },
      });
    expect(groups.listByActivity("batch").map((group) => group.id)).toEqual(["g1"]);
  });

  it.each(["OPEN", "CLOSED"] as const)("%s 活動不可再修改組別", async (state) => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "locked");
    const groups = new GroupRepository(testDatabase.database);
    groups.create({ id: "g1", activityId: "locked", name: "第一組", createdAt: now });
    const states = new ActivityStateService(testDatabase.database, () => now);
    states.transition("locked", "OPEN");
    if (state === "CLOSED") states.transition("locked", "CLOSED");
    const teacher = request.agent(app);
    await teacher.post("/api/teacher/session").expect(201);
    await teacher.post("/api/teacher/activities/locked/groups").send({ name: "新組" }).expect(409);
    await teacher.put("/api/teacher/activities/locked/groups").send({ count: 2 }).expect(409, {
      error: { code: "GROUPS_LOCKED", message: "活動開始或結束後不得修改組別。" },
    });
    await teacher.patch("/api/teacher/activities/locked/groups/g1").send({ name: "改名" }).expect(409);
    await teacher.delete("/api/teacher/activities/locked/groups/g1").expect(409);
  });

  it("公開列出可選組別，允許同組多 session，拒絕不存在及跨活動組別", async () => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "a1");
    createActivity(testDatabase, "a2");
    const groups = new GroupRepository(testDatabase.database);
    groups.create({ id: "g1", activityId: "a1", name: "第一組", createdAt: now });
    groups.create({ id: "g2", activityId: "a2", name: "第二組", createdAt: now });

    const join = await request(app).get("/api/activities/a1/join").expect(200);
    expect(join.body.groups).toEqual([{ id: "g1", name: "第一組" }]);
    await request(app).post("/api/student/session").send({ activityId: "missing", groupId: "g1" }).expect(404);
    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "g2" }).expect(404);
    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "missing" }).expect(404);
    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "g1" }).expect(201);
    await request(app).post("/api/student/session").send({ activityId: "a1", groupId: "g1" }).expect(201);
    expect(new SessionRepository(testDatabase.database).listByActivity("a1")).toHaveLength(2);
  });

  it("學生 scope 一律採用 session，URL、body、query 竄改不能跨活動或改組", async () => {
    const { app, testDatabase } = setup();
    createActivity(testDatabase, "a1");
    createActivity(testDatabase, "a2");
    const groups = new GroupRepository(testDatabase.database);
    groups.create({ id: "g1", activityId: "a1", name: "第一組", createdAt: now });
    groups.create({ id: "g2", activityId: "a2", name: "第二組", createdAt: now });
    new SessionRepository(testDatabase.database).create({
      id: "student", role: "student", activityId: "a1", groupId: "g1", createdAt: now,
      expiresAt: "2026-10-24T09:00:00.000Z",
    });

    await request(app)
      .get("/test/student/a1/private?groupId=g2")
      .set("Cookie", cookie("student"))
      .send({ groupId: "g2" })
      .expect(200, { activityId: "a1", groupId: "g1" });
    await request(app)
      .get("/test/student/a2/private")
      .set("Cookie", cookie("student"))
      .expect(403);
  });
});
