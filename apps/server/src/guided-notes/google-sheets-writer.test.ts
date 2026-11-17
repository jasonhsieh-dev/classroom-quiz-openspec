import { afterEach, expect, it, vi } from "vitest";
import { writebackFixture,teacher } from "./google-sheets-writeback-test-fixtures.js";
import { GoogleSheetsWriter, verifyWriteback, writebackBatch } from "./google-sheets-writer.js";
import type { SheetsExecutor } from "./google-sheets-reader.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
it("Writer 將可信操作權檢查傳至 transport，不加入 Google JSON payload",async () => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);
  const guard = vi.fn();const execute = vi.fn(async () => ({}));
  await new GoogleSheetsWriter({ execute } as SheetsExecutor).write(teacher,f.planner.build(teacher,f.activityId),guard);
  const input = (execute.mock.calls[0] as unknown as [unknown,{ beforeUpdate: unknown;data: object }])[1];
  expect(input.beforeUpdate).toBe(guard);expect(Object.keys(input.data)).toEqual(["requests"]);
});
it("單批使用精確 sheetId 範圍、僅 userEnteredValue 與 stringValue，保留未作答及格式", async () => {
  const f = await writebackFixture({ formula: true });cleanup.push(f.db.cleanup);
  const plan = f.planner.build(teacher,f.activityId);
  const before = await f.planner.preflight(teacher,plan);
  const execute = vi.fn(async () => { f.apply(plan);return {}; });
  await new GoogleSheetsWriter({ execute } as SheetsExecutor).write(teacher,plan);
  expect(execute).toHaveBeenCalledTimes(1);
  const input = execute.mock.calls[0] as unknown as [unknown,{ data: { requests: unknown[] } }];
  expect(input[1].data.requests[0]).toEqual({ updateCells: { range: { sheetId: 0,startRowIndex: 3,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 3 },rows: [{ values: [{ userEnteredValue: { stringValue: "=答案文字" } }] }],fields: "userEnteredValue" } });
  const after = await f.planner.read(teacher,plan);
  expect(() => verifyWriteback(plan,before.snapshot,after)).not.toThrow();
  expect(after.originalAnswers[2]!.value).toBeNull();
  expect(after.snapshot.cells.find(([address]) => address === "C4")![1].userEnteredFormat).toEqual({ backgroundColor: { red: 1 } });
});
it("非目標值、格式或合併變動不得誤報成功", async () => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);const plan = f.planner.build(teacher,f.activityId);
  const before = await f.planner.preflight(teacher,plan);f.apply(plan);
  const after = await f.planner.read(teacher,plan);
  for (const kind of ["value","format","merge"]) {
    const altered = structuredClone(after);
    if (kind === "value") altered.snapshot.cells.push(["F1",{ userEnteredValue: { stringValue: "破壞" } }]);
    if (kind === "format") altered.snapshot.cells.find(([a]) => a === "C4")![1].userEnteredFormat = { bold: true };
    if (kind === "merge") altered.snapshot.merges.push("E1:F1");
    expect(() => verifyWriteback(plan,before.snapshot,altered)).toThrow("核對");
  }
});
it("單批超限拒絕且不拆批；空計畫不發出 API 更新", async () => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);const plan = f.planner.build(teacher,f.activityId);
  const execute = vi.fn(); const writer = new GoogleSheetsWriter({ execute } as SheetsExecutor);
  await expect(writer.write(teacher,{ ...plan,targets: Array.from({ length: 1001 },() => plan.targets[0]!) })).rejects.toMatchObject({ code: "WRITEBACK_TOO_LARGE" });
  expect(() => writebackBatch({ ...plan,targets: [{ ...plan.targets[0]!,answer: "字".repeat(700000) }] })).toThrow("大小限制");
  await writer.write(teacher,{ ...plan,targets: [] });expect(execute).not.toHaveBeenCalled();
});
it("合併範圍 anchor 仍只更新左上單格", async () => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);const plan = f.planner.build(teacher,f.activityId);
  expect(writebackBatch({ ...plan,targets: [{ ...plan.targets[0]!,anchor: "AA12" }] }).requests[0]!.updateCells.range)
    .toEqual({ sheetId: 0,startRowIndex: 11,endRowIndex: 12,startColumnIndex: 26,endColumnIndex: 27 });
});
