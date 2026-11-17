import { afterEach, expect, it } from "vitest";
import request from "supertest";
import { join } from "node:path";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityRepository, GroupRepository, SessionRepository } from "../db/repositories/index.js";
import { setup as cloudSetup, url } from "./google-sheets-test-fixtures.js";
import { AppError } from "../errors.js";
const databases: TestDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.cleanup(); });
async function setup() {
  const db = createTestDatabase();databases.push(db);const cloud = cloudSetup();
  const app = createApp({ registerRoutes(app) { registerApplicationRoutes(app,db.database,{ data: db.directory,uploads: join(db.directory,"uploads"),exports: join(db.directory,"exports") },{ googleSheetsReader: cloud.reader }); } });
  const teacher = request.agent(app);await teacher.post("/api/teacher/session").expect(201);
  return { db,app,teacher,...cloud };
}
it("分頁、預覽、確認與 DTO 安全；重複確認不建立重複活動", async () => {
  const { teacher,db } = await setup();
  const list = await teacher.post("/api/teacher/imports/sheets").send({ url }).expect(200);
  expect(list.body.sheets).toHaveLength(2); expect(list.body.sheets[0]).toEqual({ sheetId: 0,title: "Notes' 中文" });
  const preview = await teacher.post("/api/teacher/imports").send({ url,sheetId: 0 }).expect(201);
  expect(preview.body).toMatchObject({ sourceKind: "google-sheets",questionCount: 3,sheetId: 0 });
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
  const path = `/api/teacher/imports/${preview.body.importId}/confirm`;
  const results = await Promise.all([teacher.post(path).send({ title: "測試" }),teacher.post(path).send({ title: "測試" })]);
  expect(results.map((r) => r.status).sort()).toEqual([201,404]);
  const result = results.find((r) => r.status === 201)!;
  expect(Object.keys(result.body).sort()).toEqual(["activityId","questionCount","state","title"]);
  expect(db.database.prepare("SELECT COUNT(*) count FROM activities").get()).toEqual({ count: 1 });
  expect(JSON.stringify(preview.body)).not.toMatch(/private_key|token|snapshot_json|sourceFilePath/);
});
it("取消與來源變更不建立活動，XLSX 上傳已停用", async () => {
  const { teacher,db,source } = await setup();
  const draft = await teacher.post("/api/teacher/imports").send({ url,sheetId: 0 }).expect(201);
  source.data![0]!.rowData![1]!.values![0] = { userEnteredValue: { stringValue: "改題目" },formattedValue: "改題目" };
  await teacher.post(`/api/teacher/imports/${draft.body.importId}/confirm`).send({ title: "test" }).expect(409);
  await teacher.delete(`/api/teacher/imports/${draft.body.importId}`).expect(204);
  await teacher.post("/api/teacher/imports").attach("file",Buffer.from("synthetic"),"fixture.xlsx").expect(400);
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
});
it("無效輸入、權限與定位錯誤維持繁體中文 API 格式", async () => {
  const { teacher,execute,source } = await setup();
  await teacher.post("/api/teacher/imports/sheets").send({ url: "https://evil.invalid" }).expect(400);
  expect(execute).not.toHaveBeenCalled();
  await teacher.post("/api/teacher/imports").send({ url,sheetId: "0" }).expect(400);
  execute.mockRejectedValueOnce(new AppError(403,"GOOGLE_PERMISSION_DENIED","Google 權限不足。"));
  await teacher.post("/api/teacher/imports/sheets").send({ url }).expect(403,{ error: { code: "GOOGLE_PERMISSION_DENIED",message: "Google 權限不足。" } });
  source.data = [];
  const response = await teacher.post("/api/teacher/imports").send({ url,sheetId: 0 }).expect(422);
  expect(response.body.error.code).toBe("HEADER_NOT_FOUND");
});
it("所有雲端匯入 API 拒絕未登入、學生與跨站，不呼叫 Google；舊活動仍可查看", async () => {
  const { app,teacher,db,execute } = await setup();
  new ActivityRepository(db.database).create({ id: "legacy",title: "歷史",sourceFilePath: "source.xlsx",sourceSha256: "hash",createdAt: new Date().toISOString() });
  new GroupRepository(db.database).create({ id: "g",activityId: "legacy",name: "組別",createdAt: new Date().toISOString() });
  new SessionRepository(db.database).create({ id: "student",role: "student",activityId: "legacy",groupId: "g",createdAt: new Date().toISOString(),expiresAt: "2099-01-01" });
  for (const path of ["/sheets","/","/draft/confirm"]) {
    await request(app).post(`/api/teacher/imports${path}`).send({ url,sheetId: 0 }).expect(401);
    await request(app).post(`/api/teacher/imports${path}`).set("Cookie","classroom_buzzer_student_session=student").send({ url,sheetId: 0 }).expect(401);
  }
  await request(app).delete("/api/teacher/imports/draft").expect(401);
  await teacher.post("/api/teacher/imports/sheets").set("Origin","https://evil.invalid").send({ url }).expect(403);
  expect(execute).not.toHaveBeenCalled();
  const snapshot = await teacher.get("/api/teacher/activities/legacy/snapshot").expect(200);
  expect(snapshot.body).toMatchObject({ sourceKind: "legacy-xlsx",title: "歷史" });
});
