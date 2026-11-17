import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../db/database.js";
import { GoogleSheetsWritebackRepository, WritebackOwnershipLost, type WritebackRow } from "../db/repositories/google-sheets-writeback-repository.js";
import { AppError } from "../errors.js";
import { GoogleSheetsWritebackService } from "./google-sheets-writeback-service.js";
import { GoogleSheetsWriter } from "./google-sheets-writer.js";
import { writebackFixture, teacher } from "./google-sheets-writeback-test-fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks();for (const close of cleanup.splice(0)) close(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise,resolve };
}
async function setup(singleUpdate = true) {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);
  let time = Date.now();
  const now = () => new Date(time);
  const writer = new GoogleSheetsWriter();
  const write = vi.spyOn(writer,"write").mockImplementation(async (_session,plan) => {
    expect(f.db.database.inTransaction).toBe(false);f.apply(plan);
  });
  const service = new GoogleSheetsWritebackService(f.db.database,f.reader,writer,now,async () => {},singleUpdate);
  const preview = await service.preview(teacher,f.activityId);
  const row = () => f.db.database.prepare("SELECT * FROM google_sheets_writebacks").get();
  return { ...f,service,writer,write,now,preview,row,expire: () => { time += 121_000; } };
}

it.each(["snapshot","error"])("租期接手成功後，舊讀取恢復 %s 不再寫入或覆寫 SUCCEEDED",async (outcome) => {
  const f = await setup();const entered = deferred();const resume = deferred();
  const read = f.reader.read.bind(f.reader);
  vi.spyOn(f.reader,"read").mockImplementationOnce(async (...args) => {
    const snapshot = await read(...args);entered.resolve();await resume.promise;
    if (outcome === "error") throw new AppError(503,"GOOGLE_CONNECTION_FAILED","synthetic");
    return snapshot;
  });
  const first = f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await entered.promise;f.expire();
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("FAILED");
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");
  const succeeded = f.row();resume.resolve();
  expect((await first).state).toBe("SUCCEEDED");
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.row()).toEqual(succeeded);
});

it("沒有接手者時租期過期也不能憑舊讀取取得寫入資格",async () => {
  const f = await setup();const entered = deferred();const resume = deferred();const read = f.reader.read.bind(f.reader);
  vi.spyOn(f.reader,"read").mockImplementationOnce(async (...args) => {
    const snapshot = await read(...args);entered.resolve();await resume.promise;return snapshot;
  });
  const first = f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await entered.promise;f.expire();resume.resolve();
  expect((await first).state).toBe("UNKNOWN");expect(f.write).not.toHaveBeenCalled();
  await f.service.reconcile(teacher,f.activityId,f.preview.operationId!);
  expect((await f.service.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");
  expect(f.write).toHaveBeenCalledTimes(1);
});

it("一般模式的舊請求也受 fencing 保護",async () => {
  const f = await setup(false);const entered = deferred();const resume = deferred();const read = f.reader.read.bind(f.reader);
  vi.spyOn(f.reader,"read").mockImplementationOnce(async (...args) => {
    const snapshot = await read(...args);entered.resolve();await resume.promise;return snapshot;
  });
  const first = f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await entered.promise;f.expire();
  await f.service.reconcile(teacher,f.activityId,f.preview.operationId!);
  await f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  const succeeded = f.row();resume.resolve();await first;
  expect(f.write).toHaveBeenCalledTimes(1);expect(f.row()).toEqual(succeeded);
});

it("SQLite CAS 拒絕過期 owner 與第二次資格，接手及一般模式均不能清除嘗試標記",async () => {
  const f = await setup();const repository = new GoogleSheetsWritebackRepository(f.db.database);
  const a = f.row() as WritebackRow;repository.claim(a,"owner-a",f.now());f.expire();
  const b = f.row() as WritebackRow;repository.claim(b,"owner-b",f.now());
  expect(() => repository.admitWrite(a,{},true,f.now())).toThrow(WritebackOwnershipLost);
  repository.admitWrite(b,{},true,f.now());
  expect(() => repository.admitWrite(b,{},true,f.now())).toThrow(WritebackOwnershipLost);
  expect(() => repository.finish(a,"FAILED","STALE",f.now())).toThrow(WritebackOwnershipLost);
  f.expire();const c = f.row() as WritebackRow;repository.claim(c,"owner-c",f.now());
  expect(JSON.parse(c.targets_json).singleUpdateAttempted).toBe(true);
  expect(() => repository.admitWrite(c,{},false,f.now())).toThrow(WritebackOwnershipLost);
  expect(f.write).not.toHaveBeenCalled();
});

it.each(["success","lost-response"])("已取得單次資格後租期過期，重啟接手不得再更新：%s",async (outcome) => {
  const f = await setup();const entered = deferred();const resume = deferred();
  f.write.mockImplementationOnce(async (_session,plan) => {
    entered.resolve();await resume.promise;f.apply(plan);
    if (outcome === "lost-response") throw new AppError(503,"GOOGLE_CONNECTION_FAILED","synthetic");
  });
  const first = f.service.confirm(teacher,f.activityId,f.preview.operationId!);
  await entered.promise;f.expire();
  const connection = initializeDatabase(f.db.filename);
  try {
    const restarted = new GoogleSheetsWritebackService(connection,f.reader,f.writer,f.now,async () => {},true);
    expect((await restarted.confirm(teacher,f.activityId,f.preview.operationId!)).state).toBe("UNKNOWN");
    expect((await restarted.reconcile(teacher,f.activityId,f.preview.operationId!)).state).toBe("FAILED");
    expect((await restarted.confirm(teacher,f.activityId,f.preview.operationId!)).canRetry).toBe(false);
    const recovered = f.row();resume.resolve();await first;
    expect(f.row()).toEqual(recovered); // The stale writer cannot publish its own result.
    expect((await restarted.reconcile(teacher,f.activityId,f.preview.operationId!)).state).toBe("SUCCEEDED");
    await restarted.confirm(teacher,f.activityId,f.preview.operationId!);
    expect(f.write).toHaveBeenCalledTimes(1);
  } finally { resume.resolve();connection.close(); }
});
