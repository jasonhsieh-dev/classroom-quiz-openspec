import { expect, it, vi } from "vitest";
import { GoogleSheetsReader, parseGoogleSheetsUrl, type SheetsExecutor } from "./google-sheets-reader.js";
import { teacher, url, sheet, setup } from "./google-sheets-test-fixtures.js";
const cell = (value: string) => ({ userEnteredValue: { stringValue: value }, formattedValue: value });
it("從雲端 GET 選單一分頁，重用移動表頭與欄序，接受稀疏空白作答及混合題號", async () => {
  const { reader,execute } = setup();
  const result = await reader.read(teacher,url,0);
  expect(result.mappings.map((m) => [m.displayNumber,m.numberCell,m.answerAnchor])).toEqual([["1","D4","C4"],["2-1","D5","C5"],["2-2","D6","C6"]]);
  expect(execute).toHaveBeenLastCalledWith(teacher,expect.objectContaining({ action: "get", ranges: ["'Notes'' 中文'!A1:F10"], fields: expect.stringContaining("userEnteredValue") }));
  expect(result.snapshot.cells).toHaveLength(12);
  expect((await reader.listSheets(teacher,url)).sheets).toHaveLength(2);
});
it.each(["http://docs.google.com/spreadsheets/d/id/edit","https://evil.invalid/spreadsheets/d/id","https://docs.google.com.evil.invalid/spreadsheets/d/id","https://user:pass@docs.google.com/spreadsheets/d/id","https://docs.google.com/spreadsheets/d/id%2Fbad","https://docs.google.com/spreadsheets/d/id/edit#gid=no","https://docs.google.com/spreadsheets/d/id/edit?gid=1#gid=2", "id"]) ("拒絕無效網址 %s", (value) => { expect(() => parseGoogleSheetsUrl(value)).toThrow(); });
it("保留網址 id 與可選 gid；拒絕文件以外分頁", async () => {
  expect(parseGoogleSheetsUrl(url)).toEqual({ spreadsheetId: "synthetic", sheetId: 0 });
  const { reader,execute } = setup();
  await expect(reader.read(teacher,url,99)).rejects.toMatchObject({ code: "GOOGLE_SHEET_NOT_FOUND" });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("合併題目／答案使用 anchor，保存公式、顯示文字及樣式", async () => {
  const source = sheet();
  source.merges = [{ sheetId: 0,startRowIndex: 3,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 3 }];
  source.data![0]!.rowData![1]!.values![0] = { userEnteredValue: { formulaValue: '=CONCAT("題","目")' }, formattedValue: "題目內容", effectiveValue: { stringValue: "題目內容" }, userEnteredFormat: { wrapStrategy: "WRAP" } };
  source.data![0]!.rowData![1]!.values![1] = { userEnteredValue: { formulaValue: '=IF(TRUE,"","")' }, formattedValue: "" };
  const result = await setup(source).reader.read(teacher,url,0);
  expect(result.mappings[0]).toMatchObject({ promptText: "題目內容", answerAnchor: "C4" });
  expect(result.originalAnswers[0]?.value).toEqual({ formulaValue: '=IF(TRUE,"","")' });
  const previous = result.structureFingerprint;
  source.data![0]!.rowData![1]!.values![0]!.formattedValue = "重新計算";
  expect((await setup(source).reader.read(teacher,url,0)).structureFingerprint).toBe(previous);
});
it.each(["duplicate","headers","missing","overlap","sharedPrompt","answerOverPrompt"]) ("不明確定位拒絕 %s", async (kind) => {
  const source = sheet(), rows = source.data![0]!.rowData!;
  if (kind === "duplicate") rows[2]!.values![2] = cell("１");
  if (kind === "headers") rows[3] = structuredClone(rows[0]!);
  if (kind === "missing") rows[1]!.values![0] = {};
  if (kind === "overlap") source.merges = [{ startRowIndex: 3,endRowIndex: 5,startColumnIndex: 2,endColumnIndex: 3 }];
  if (kind === "sharedPrompt") source.merges = [{ startRowIndex: 3,endRowIndex: 5,startColumnIndex: 1,endColumnIndex: 2 }];
  if (kind === "answerOverPrompt") source.merges = [{ startRowIndex: 3,endRowIndex: 4,startColumnIndex: 1,endColumnIndex: 3 }];
  await expect(setup(source).reader.read(teacher,url,0)).rejects.toThrow();
});
it("其他分頁也有表頭不造成所選分頁歧義", async () => {
  const source = sheet(); const second = structuredClone(source);second.properties.sheetId = 8;
  const execute = vi.fn(async () => ({ spreadsheetId: "synthetic", sheets: [second,source] }));
  const reader = new GoogleSheetsReader({ execute } as SheetsExecutor);
  expect((await reader.read(teacher,url,0)).mappings).toHaveLength(3);
});
it("超限分頁在讀 grid 前拒絕；無效網格不猜測", async () => {
  const source = sheet();source.properties.gridProperties.rowCount = 100001;
  const { reader,execute } = setup(source);
  await expect(reader.read(teacher,url,0)).rejects.toMatchObject({ code: "GOOGLE_GRID_TOO_LARGE" });
  expect(execute).toHaveBeenCalledTimes(1);
  const invalid = sheet(); invalid.data![0]!.startRow = 100;
  await expect(setup(invalid).reader.read(teacher,url,0)).rejects.toMatchObject({ code: "GOOGLE_GRID_INVALID" });
});
it("無表頭、無題目及重複表頭欄都拒絕", async () => {
  for (const kind of ["none","empty","columns"]) {
    const source = sheet();
    if (kind === "none") source.data = [];
    if (kind === "empty") source.data![0]!.rowData = [source.data![0]!.rowData![0]!];
    if (kind === "columns") source.data![0]!.rowData![0]!.values!.push(cell("作答"));
    await expect(setup(source).reader.read(teacher,url,0)).rejects.toThrow();
  }
});

it("水平合併答案與跨列題目保留完整範圍，空白延伸列不新增題目", async () => {
  const source = sheet(); source.data![0]!.startColumn = 0;
  const rows = source.data![0]!.rowData!;
  for (const row of rows) { const old = row.values!; row.values = [old[2]!,old[0]!,old[1]!]; }
  source.merges = [{ startRowIndex: 3,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 4 },
    { startRowIndex: 5,endRowIndex: 7,startColumnIndex: 1,endColumnIndex: 2 }];
  const result = await setup(source).reader.read(teacher,url,0);
  expect(result.mappings[0]).toMatchObject({ answerAnchor: "C4",answerRange: "C4:D4",numberCell: "A4" });
  expect(result.mappings[2]).toMatchObject({ promptRange: "B6:B7" });
});
it("稀疏區塊可從零座標開始，保留數值與布林顯示", async () => {
  const source = sheet(); source.data![0]!.startRow = 0;
  source.data![0]!.rowData![1]!.values![2] = { userEnteredValue: { numberValue: 1 },formattedValue: "01" };
  source.data![0]!.rowData![1]!.values![1] = { userEnteredValue: { boolValue: false },formattedValue: "FALSE", userEnteredFormat: { numberFormat: { type: "TEXT" } } };
  const result = await setup(source).reader.read(teacher,url,0);
  expect(result.mappings[0]).toMatchObject({ displayNumber: "01",originalAnswer: "FALSE" });
  expect(result.originalAnswers[0]!.value).toEqual({ boolValue: false });
});

it("答案合併到表頭會拒絕，不能寫入表頭 anchor", async () => {
  const source = sheet();source.merges = [{ startRowIndex: 2,endRowIndex: 4,startColumnIndex: 2,endColumnIndex: 3 }];
  await expect(setup(source).reader.read(teacher,url,0)).rejects.toMatchObject({ code: "GOOGLE_GRID_INVALID" });
});
