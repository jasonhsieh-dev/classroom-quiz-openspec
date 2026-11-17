import { afterEach, expect, it, vi } from "vitest";
import { initializeDatabase } from "../db/database.js";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { GoogleSheetsSourceRepository } from "../db/repositories/google-sheets-source-repository.js";
import { GoogleSheetsImportService } from "./google-sheets-import-service.js";
import { setup, teacher, url } from "./google-sheets-test-fixtures.js";
import { SnapshotService } from "../services/snapshot-service.js";
import { ActivityLifecycleService } from "../services/activity-lifecycle.js";
import { GroupService } from "../services/group-service.js";
import { backfillQuestionPrompts } from "./prompt-backfill.js";
const databases: TestDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.cleanup(); });
function context() {
  const db = createTestDatabase();databases.push(db);
  const cloud = setup(); let now = new Date("2026-11-17T00:00:00Z");
  const service = new GoogleSheetsImportService(db.database,cloud.reader,() => now);
  return { db, ...cloud, service, advance: () => { now = new Date(now.getTime()+31*60_000); } };
}
it("確認後才保存來源、題目與快照；重啟與 Google 離線仍可開始及恢復", async () => {
  const { db, service, execute } = context();
  const draft = await service.createDraft(teacher,url,0);
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
  expect(draft.questionCount).toBe(3);
  const activity = await service.confirmDraft(teacher,draft.importId,"展示");
  expect(activity).toMatchObject({ state: "DRAFT", sourceKind: "google-sheets", sourceFilePath: null });
  expect(db.database.prepare("SELECT * FROM google_sheets_import_drafts").all()).toEqual([]);
  const source = new GoogleSheetsSourceRepository(db.database).findByActivity(activity.id)!;
  expect(source.mapping).toHaveLength(3);
  expect(source.structureFingerprint).toHaveLength(64);
  const second = initializeDatabase(db.filename);
  try {
    execute.mockRejectedValue(new Error("offline"));
    expect(new SnapshotService(second).teacher(activity.id).questions).toHaveLength(3);
    new GroupService(second).create(activity.id,"第一組"); new GroupService(second).create(activity.id,"第二組");
    expect(new ActivityLifecycleService(second).open(activity.id).state).toBe("OPEN");
    expect(new SnapshotService(second).teacher(activity.id).state).toBe("OPEN");
    expect(await backfillQuestionPrompts(second)).toEqual({ updatedActivityIds: [], unchangedActivityIds: [], failures: [] });
  } finally { second.close(); }
});
it.each(["prompt","answer","formula","merge","number"]) ("確認前變動 %s 拒絕並不留下部分活動", async (kind) => {
  const { db,service,source } = context();const draft = await service.createDraft(teacher,url,0);
  const cells = source.data![0]!.rowData![1]!.values!;
  if (kind === "prompt") cells[0] = { userEnteredValue: { stringValue: "新題目" },formattedValue: "新題目" };
  if (kind === "answer") cells[1] = { userEnteredValue: { stringValue: "老師已修改" },formattedValue: "老師已修改" };
  if (kind === "formula") cells[1] = { userEnteredValue: { formulaValue: '=IF(TRUE,"","")' },formattedValue: "" };
  if (kind === "merge") source.merges = [{ startRowIndex: 3,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 3 }];
  if (kind === "number") cells[2] = { userEnteredValue: { stringValue: "改題號" },formattedValue: "改題號" };
  await expect(service.confirmDraft(teacher,draft.importId,"展示")).rejects.toMatchObject({ code: "GOOGLE_SOURCE_CHANGED" });
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
});
it("取消、到期及無效題目不建立活動", async () => {
  const { db,service,advance } = context();const draft = await service.createDraft(teacher,url,0);
  service.cancelDraft(teacher,draft.importId);
  await expect(service.confirmDraft(teacher,draft.importId,"展示")).rejects.toMatchObject({ code: "IMPORT_DRAFT_NOT_FOUND" });
  const expired = await service.createDraft(teacher,url,0); advance();
  await expect(service.confirmDraft(teacher,expired.importId,"展示")).rejects.toMatchObject({ code: "IMPORT_DRAFT_EXPIRED" });
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
});
it("確認網路等待期間取消，交易內再檢查避免建立活動", async () => {
  const { db,service,reader } = context();const draft = await service.createDraft(teacher,url,0);
  const result = await reader.read(teacher,url,0);
  vi.spyOn(reader,"read").mockImplementationOnce(async () => { service.cancelDraft(teacher,draft.importId); return result; });
  await expect(service.confirmDraft(teacher,draft.importId,"展示")).rejects.toMatchObject({ code: "IMPORT_DRAFT_NOT_FOUND" });
  expect(db.database.prepare("SELECT * FROM activities").all()).toEqual([]);
});
it("同一草稿並行確認最多建立一場活動", async () => {
  const { db,service } = context();const draft = await service.createDraft(teacher,url,0);
  const results = await Promise.allSettled([service.confirmDraft(teacher,draft.importId,"展示"),service.confirmDraft(teacher,draft.importId,"展示")]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(db.database.prepare("SELECT COUNT(*) AS count FROM activities").get()).toEqual({ count: 1 });
});
it("草稿建立失敗及錯誤角色不存資料也不讀 Google", async () => {
  const { db,service,execute } = context();
  await expect(service.createDraft({ ...teacher,role: "student" },url,0)).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
  expect(execute).not.toHaveBeenCalled();
  execute.mockRejectedValueOnce(new Error("mock offline"));
  await expect(service.createDraft(teacher,url,0)).rejects.toThrow("mock offline");
  expect(db.database.prepare("SELECT * FROM google_sheets_import_drafts").all()).toEqual([]);
});

it("持久化中失敗整筆回滾且草稿可重試", async () => {
  const { db,reader } = context();
  const service = new GoogleSheetsImportService(db.database,reader,() => new Date("2026-11-17T00:00:00Z"),() => "duplicate-id");
  const draft = await service.createDraft(teacher,url,0);
  await expect(service.confirmDraft(teacher,draft.importId,"展示")).rejects.toThrow();
  for (const table of ["activities","questions","google_sheets_sources"]) expect(db.database.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  expect(db.database.prepare("SELECT * FROM google_sheets_import_drafts").all()).toHaveLength(1);
});
it("Google 等待期間草稿到期仍拒絕", async () => {
  const { service,reader,advance } = context();const draft = await service.createDraft(teacher,url,0);
  const result = await reader.read(teacher,url,0);
  vi.spyOn(reader,"read").mockImplementationOnce(async () => { advance(); return result; });
  await expect(service.confirmDraft(teacher,draft.importId,"展示")).rejects.toMatchObject({ code: "IMPORT_DRAFT_EXPIRED" });
});
