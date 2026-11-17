import { afterEach, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { registerApplicationRoutes } from "../application-routes.js";
import { GoogleSheetsWritebackService } from "./google-sheets-writeback-service.js";
import { GoogleSheetsWriter } from "./google-sheets-writer.js";
import { writebackFixture } from "./google-sheets-writeback-test-fixtures.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
async function setup(singleUpdate = false) {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);
  const writer = new GoogleSheetsWriter();const write = vi.spyOn(writer,"write").mockImplementation(async (_s,plan) => { f.apply(plan); });
  const service = new GoogleSheetsWritebackService(f.db.database,f.reader,writer,() => new Date(),async () => {},singleUpdate);
  const app = createApp({ registerRoutes(app) { registerApplicationRoutes(app,f.db.database,{ data: f.db.directory,uploads: f.db.directory,exports: f.db.directory },{ googleSheetsReader: f.reader,googleSheetsWritebacks: service }); } });
  const teacher = request.agent(app);await teacher.post("/api/teacher/session").expect(201);
  return { ...f,app,teacher,write,path: `/api/teacher/activities/${f.activityId}/writeback` };
}
it("權限隔離、明確確認、預覽與狀態 DTO，不洩漏內部紀錄", async () => {
  const f = await setup();f.execute.mockClear();
  for (const suffix of ["/preview","/confirm","/reconcile"]) {
    await request(f.app).post(`${f.path}${suffix}`).send({}).expect(401);
    await request(f.app).post(`${f.path}${suffix}`).set("Cookie",`classroom_buzzer_student_session=${encodeURIComponent("甲")}`).send({}).expect(401);
  }
  await request(f.app).get(f.path).expect(401);
  await f.teacher.post(`${f.path}/preview`).set("Origin","https://evil.invalid").expect(403);
  expect(f.execute).not.toHaveBeenCalled();
  expect((await f.teacher.get(f.path).expect(200)).body.state).toBe("NOT_PREPARED");
  const preview = await f.teacher.post(`${f.path}/preview`).expect(200);
  expect(preview.body.state).toBe("PREPARED");expect(preview.body.targets).toHaveLength(2);
  expect(JSON.stringify(preview.body)).not.toMatch(/private_key|targets_json|snapshot|source_file_path/);
  await f.teacher.post(`${f.path}/confirm`).send({ operationId: preview.body.operationId }).expect(400);
  expect(f.write).not.toHaveBeenCalled();
  await f.teacher.post(`${f.path}/confirm`).send({ operationId: "wrong",confirmed: true }).expect(409);
  const success = await f.teacher.post(`${f.path}/confirm`).send({ operationId: preview.body.operationId,confirmed: true }).expect(200);
  expect(success.body.state).toBe("SUCCEEDED");
  expect((await f.teacher.get(f.path).expect(200)).body.state).toBe("SUCCEEDED");
  await f.teacher.post(`${f.path}/confirm`).send({ operationId: preview.body.operationId,confirmed: true }).expect(200);
  expect(f.write).toHaveBeenCalledTimes(1);
});
it.each(["DRAFT","OPEN"])("%s API 禁止預覽及寫回", async (state) => {
  const f = await setup();f.execute.mockClear();f.db.database.prepare("UPDATE activities SET state=? WHERE id=?").run(state,f.activityId);
  await f.teacher.post(`${f.path}/preview`).expect(409);
  await f.teacher.post(`${f.path}/confirm`).send({ operationId: "wrong",confirmed: true }).expect(409);
  expect(f.execute).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
});

it.each([true,false])("唯讀 runtime 回傳有效模式 %s 並與寫回狀態同一服務實例", async (enabled) => {
  const f = await setup(enabled);f.execute.mockClear();
  const before = f.db.database.prepare("SELECT * FROM google_sheets_writebacks").all();
  await request(f.app).get(`${f.path}/runtime`).expect(401);
  await request(f.app).get(`${f.path}/runtime`).set("Cookie",`classroom_buzzer_student_session=${encodeURIComponent("甲")}`).expect(401);
  const result = await f.teacher.get(`${f.path}/runtime?singleUpdateMode=${!enabled}`).expect(200);
  expect(result.body.singleUpdateMode).toBe(enabled);
  expect(Object.keys(result.body).sort()).toEqual(["instanceId","singleUpdateMode"]);
  expect(result.headers["cache-control"]).toBe("no-store");
  const status = await f.teacher.get(f.path).expect(200);
  expect(status.body.instanceId).toBe(result.body.instanceId);expect(status.body.singleUpdateMode).toBe(enabled);
  expect((await f.teacher.get(`${f.path}/runtime`).expect(200)).body).toEqual(result.body);
  expect(f.write).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled();
  expect(f.db.database.prepare("SELECT * FROM google_sheets_writebacks").all()).toEqual(before);
  expect((await request(f.app).get("/api/health").expect(200)).body).toEqual({ status: "ok",service: "classroom-buzzer-server" });
});
