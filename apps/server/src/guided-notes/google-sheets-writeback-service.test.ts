import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import { GoogleSheetsWritebackService } from "./google-sheets-writeback-service.js";
import { GoogleSheetsWriter } from "./google-sheets-writer.js";
import { writebackFixture,teacher } from "./google-sheets-writeback-test-fixtures.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
async function setup(options = {}, singleUpdate = false) {
  const f = await writebackFixture(options);cleanup.push(f.db.cleanup);
  const writer = new GoogleSheetsWriter();
  const write = vi.spyOn(writer,"write").mockImplementation(async (_session,plan) => { expect(f.db.database.inTransaction).toBe(false);f.apply(plan); });
  const sleep = vi.fn(async () => {});
  const service = new GoogleSheetsWritebackService(f.db.database,f.reader,writer,() => new Date(),sleep,singleUpdate);
  const preview = await service.preview(teacher,f.activityId);
  return { ...f,writer,write,service,preview,sleep };
}
it("預覽不更新雲端，明確確認後才寫回，成功重送不再次寫入", async () => {
  const f = await setup();expect(f.write).not.toHaveBeenCalled();expect(f.preview.state).toBe("PREPARED");
  const results = f.db.database.prepare("SELECT * FROM result_entries").all();
  const first = await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  expect(first.state).toBe("SUCCEEDED");
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");
  expect(f.write).toHaveBeenCalledTimes(1);
  expect(f.db.database.prepare("SELECT * FROM result_entries").all()).toEqual(results);
  expect(f.db.database.prepare("SELECT state FROM activities WHERE id=?").get(f.activityId)).toEqual({ state: "CLOSED" });
});
it("無答案不建立操作或更新請求", async () => {
  const f = await setup({ noAnswers: true });expect(f.preview.state).toBe("NO_ANSWERS");expect(f.preview.operationId).toBeNull();expect(f.write).not.toHaveBeenCalled();
});
it("確認前目標變動標示衝突，不寫回", async () => {
  const f = await setup();f.source.data![0]!.rowData![1]!.values![1] = { userEnteredValue: { stringValue: "老師填寫" } };
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("CONFLICT");expect(f.write).not.toHaveBeenCalled();
});
it.each(["GOOGLE_AUTH_FAILED","GOOGLE_PERMISSION_DENIED","GOOGLE_DOCUMENT_UNAVAILABLE","GOOGLE_REQUEST_REJECTED"])("拒絕 %s 不重試、不部分寫入", async (code) => {
  const f = await setup();const before = structuredClone(f.source);
  f.write.mockRejectedValue(new AppError(403,code,"secret"));
  const result = await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  expect(result).toMatchObject({ state: "FAILED",errorCode: code });expect(f.write).toHaveBeenCalledTimes(1);expect(f.source).toEqual(before);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it.each(["GOOGLE_QUOTA_EXCEEDED","GOOGLE_API_FAILED"])("%s 有限退避後重試，重新核對原值", async (code) => {
  const f = await setup();f.write.mockRejectedValueOnce(new AppError(503,code,"暫時錯誤"));
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(2);expect(f.sleep).toHaveBeenCalledTimes(1);
});
it("配額錯誤最多三次，不無限重試", async () => {
  const f = await setup();f.write.mockRejectedValue(new AppError(429,"GOOGLE_QUOTA_EXCEEDED","配額"));
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("FAILED");expect(f.write).toHaveBeenCalledTimes(3);expect(f.sleep).toHaveBeenCalledTimes(2);
});
it("成功但回應遺失，讀回確認成功而不重送", async () => {
  const f = await setup();f.write.mockImplementationOnce(async (_s,plan) => { f.apply(plan);throw new AppError(503,"GOOGLE_CONNECTION_FAILED","timeout"); });
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(1);
});
it("逾時未寫入，核對後允許明確重試，不自動重送", async () => {
  const f = await setup();f.write.mockRejectedValueOnce(new AppError(503,"GOOGLE_CONNECTION_FAILED","timeout"));
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!))).toMatchObject({ state: "FAILED",canRetry: true });expect(f.write).toHaveBeenCalledTimes(1);
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(2);
});
it("核對網路失敗保持 UNKNOWN，恢復後只核對不寫入", async () => {
  const f = await setup();const read = f.execute.getMockImplementation()!;
  f.write.mockImplementationOnce(async (_s,plan) => { f.apply(plan);f.execute.mockRejectedValue(new AppError(503,"GOOGLE_CONNECTION_FAILED","offline"));throw new AppError(503,"GOOGLE_CONNECTION_FAILED","timeout"); });
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!))).toMatchObject({ state: "UNKNOWN",canRetry: false });
  f.execute.mockImplementation(read);
  expect((await f.service.reconcile(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(1);
});
it("混合目標或非目標格式變更均停止，不回滾或重送", async () => {
  for (const kind of ["mixed","format"]) {
    const f = await setup();
    f.write.mockImplementationOnce(async (_s,plan) => {
      if (kind === "mixed") f.apply({ ...plan,targets: plan.targets.slice(0,1) });
      else { f.apply(plan);f.source.data![0]!.rowData![1]!.values![1]!.userEnteredFormat = { bold: true }; }
      throw new AppError(503,"GOOGLE_CONNECTION_FAILED","timeout");
    });
    expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("CONFLICT");expect(f.write).toHaveBeenCalledTimes(1);
  }
});
it("兩個 service 並行確認最多一個更新請求", async () => {
  const f = await setup();let release!: () => void;let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });const writing = new Promise<void>((resolve) => { entered = resolve; });
  f.write.mockImplementationOnce(async (_s,plan) => { entered();await gate;f.apply(plan); });
  const first = f.service.confirm(teacher,f.activityId,f.preview.operationId!);await writing;
  const second = new GoogleSheetsWritebackService(f.db.database,f.reader,f.writer);
  expect((await second.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("IN_FLIGHT");release();
  expect((await first).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(1);
});
it("程序遺留 IN_FLIGHT 等租期過後先核對；原值未變只允許後續明確重試", async () => {
  const f = await setup();f.db.database.exec("UPDATE google_sheets_writebacks SET state='IN_FLIGHT',updated_at='2000-01-01T00:00:00Z'");
  const restarted = new GoogleSheetsWritebackService(f.db.database,f.reader,f.writer);
  expect(restarted.status(teacher,f.activityId).state).toBe("UNKNOWN");
  expect((await restarted.confirm(teacher,f.activityId,f.preview.operationId!))).toMatchObject({ state: "FAILED",canRetry: true });expect(f.write).not.toHaveBeenCalled();
});
it("雲端成功但 SQLite 更新失敗，保存 UNKNOWN 後可核對恢復", async () => {
  const f = await setup();f.db.database.exec("CREATE TRIGGER fail_success BEFORE UPDATE ON google_sheets_writebacks WHEN NEW.state='SUCCEEDED' BEGIN SELECT RAISE(ABORT,'simulated'); END");
  await expect(f.service.confirm(teacher,f.activityId,f.preview.operationId!)).rejects.toMatchObject({ code: "WRITEBACK_RECORD_UNAVAILABLE" });
  expect(f.service.status(teacher,f.activityId).state).toBe("UNKNOWN");f.db.database.exec("DROP TRIGGER fail_success");
  expect((await f.service.reconcile(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");expect(f.write).toHaveBeenCalledTimes(1);
});

it.each(["success","GOOGLE_QUOTA_EXCEEDED","GOOGLE_API_FAILED","GOOGLE_CONNECTION_FAILED","lost-response"])("單次模式 %s 不重送，同一 ID 永久拒絕第二次更新", async (kind) => {
  const f = await setup({},true);
  if (kind === "lost-response") f.write.mockImplementation(async (_s,plan) => { f.apply(plan);throw new AppError(503,"GOOGLE_CONNECTION_FAILED","lost"); });
  else if (kind !== "success") f.write.mockRejectedValue(new AppError(503,kind,"synthetic"));
  await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await f.service.reconcile(teacher,f.activityId,f.preview.operationId!);
  await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  expect(f.write).toHaveBeenCalledTimes(1);
  const restarted = new GoogleSheetsWritebackService(f.db.database,f.reader,f.writer);
  await restarted.confirm(teacher,f.activityId,f.preview.operationId!);
  expect(f.write).toHaveBeenCalledTimes(1);
});
it("單次模式並行確認最多一次，renew 重新讀取並產生新 ID 才能再確認", async () => {
  const f = await setup({},true);f.write.mockRejectedValueOnce(new AppError(429,"GOOGLE_QUOTA_EXCEEDED","quota"));
  await Promise.all([f.service.confirm(teacher,f.activityId,f.preview.operationId!),f.service.confirm(teacher,f.activityId,f.preview.operationId!)]);
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.service.status(teacher,f.activityId).canRetry).toBe(false);
  const next = await f.service.renew(teacher,f.activityId,f.preview.operationId!);
  expect(next.operationId).not.toBe(f.preview.operationId);expect(next.state).toBe("PREPARED");
  await expect(f.service.confirm(teacher,f.activityId,f.preview.operationId!)).rejects.toThrow();
  expect((await f.service.confirm(teacher,f.activityId,next.operationId!)).state).toBe("SUCCEEDED");
  expect(f.write).toHaveBeenCalledTimes(2);
});
