import { afterEach, expect, it } from "vitest";
import { writebackFixture,teacher } from "./google-sheets-writeback-test-fixtures.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
it("CLOSED 計畫只含第一名，未作答不列入，公式原值保留", async () => {
  const f = await writebackFixture({ formula: true });cleanup.push(f.db.cleanup);
  const before = f.db.database.prepare("SELECT * FROM result_entries").all();
  const plan = f.planner.build(teacher,f.activityId);
  expect(plan.targets.map((t) => t.answer)).toEqual(["=答案文字","第二題答案"]);
  expect(plan.targets[0]).toMatchObject({ anchor: "C4",originalValue: { formulaValue: '=IF(TRUE,"","")' } });
  await expect(f.planner.preflight(teacher,plan)).resolves.toMatchObject({ sheetId: 0 });
  expect(f.db.database.prepare("SELECT * FROM result_entries").all()).toEqual(before);
});
it("沒有獲勝者產生空計畫", async () => {
  const f = await writebackFixture({ noAnswers: true });cleanup.push(f.db.cleanup);
  expect(f.planner.build(teacher,f.activityId).targets).toEqual([]);
});
it.each(["DRAFT","OPEN"])("%s 在讀 Google 之前拒絕寫回", async (state) => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);f.execute.mockClear();
  f.db.database.prepare("UPDATE activities SET state=? WHERE id=?").run(state,f.activityId);
  expect(() => f.planner.build(teacher,f.activityId)).toThrow("只有已結束");
  expect(f.execute).not.toHaveBeenCalled();
});
it.each(["prompt","answer","merge","move"])("來源 %s 變動停止", async (kind) => {
  const f = await writebackFixture();cleanup.push(f.db.cleanup);const plan = f.planner.build(teacher,f.activityId);
  if (kind === "answer") f.source.data![0]!.rowData![1]!.values![1] = { userEnteredValue: { stringValue: "老師填寫" },formattedValue: "老師填寫" };
  if (kind === "prompt") f.source.data![0]!.rowData![1]!.values![0]!.userEnteredValue = { stringValue: "新題目" };
  if (kind === "merge") f.source.merges = [{ startRowIndex: 3,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 3 }];
  if (kind === "move") f.source.properties.gridProperties.columnCount++;
  await expect(f.planner.preflight(teacher,plan)).rejects.toMatchObject({ code: "GOOGLE_SOURCE_CHANGED" });
});
