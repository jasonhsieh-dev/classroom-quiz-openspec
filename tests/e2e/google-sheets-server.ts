import { GoogleSheetsWriter } from "../../apps/server/src/guided-notes/google-sheets-writer.js";
import type { CloudSheet } from "../../apps/server/src/guided-notes/google-sheets-reader.js";
// Test-only entry point: production startServer() never loads synthetic cloud data.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { startServer } from "../../apps/server/src/index.js";
import { initializeDatabase } from "../../apps/server/src/db/database.js";
import { ensureRuntimeDirectories, resolveRuntimePaths } from "../../apps/server/src/config/runtime-paths.js";
import { GuidedNotesImportService } from "../../apps/server/src/guided-notes/import-service.js";
import { GoogleSheetsReader, type SheetsExecutor } from "../../apps/server/src/guided-notes/google-sheets-reader.js";
const paths = resolveRuntimePaths(process.env);
if (resolve(paths.data) !== resolve("var/e2e/data")) throw new Error("E2E requires isolated runtime");
await ensureRuntimeDirectories(paths);
const database = initializeDatabase(join(paths.data,"classroom-quiz.sqlite"));
try {
  const service = new GuidedNotesImportService(database,paths);
  const draft = await service.createDraft({ filename: "歷史學習單.xlsx",mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer: await readFile("tests/fixtures/guided-notes/reference-single-template.xlsx") });
  const activity = await service.confirmDraft(draft.importId,{ title: "歷史 XLSX 活動" });
  await writeFile("var/e2e/legacy.json",JSON.stringify(activity));
} finally { database.close(); }
const cell = (text: string) => ({ userEnteredValue: { stringValue: text },formattedValue: text });
const source: CloudSheet = { properties: { sheetId: 0,title: "雲端學習單",gridProperties: { rowCount: 10,columnCount: 4 } },data: [{ rowData: [
  { values: [cell("題號"),cell("題目"),cell("作答")] },
  ...Array.from({ length: 6 },(_,i) => ({ values: [cell(String(i+1)),cell(`雲端合成題目 ${i+1}`),{}] })),
] }] };
// Rich synthetic document: preserve merged answer, styles, untouched formula and another tab.
source.merges = [{ sheetId: 0,startRowIndex: 1,endRowIndex: 2,startColumnIndex: 2,endColumnIndex: 4 }];
source.data![0]!.rowData![1]!.values![2] = { userEnteredFormat: { textFormat: { bold: true },backgroundColor: { red: 1 } } };
source.data![0]!.rowData![6]!.values![2] = { userEnteredValue: { formulaValue: '=IF(TRUE,"","")' },formattedValue: "" };
source.data![0]!.rowData!.push({ values: [{},{},{},{ userEnteredValue: { formulaValue: '=1+2' },formattedValue: "3",userEnteredFormat: { numberFormat: { type: "NUMBER" } } }] });
const sheets = [source,{ properties: { sheetId: 8,title: "其他分頁",gridProperties: { rowCount: 10,columnCount: 4 } },data: structuredClone(source.data) }] as CloudSheet[];
const api = { async execute(_session,input) {
  if (input.action === "batchUpdate") {
    const before = structuredClone(sheets);
    const requests = input.data?.requests as { updateCells: { range: { sheetId: number;startRowIndex: number;startColumnIndex: number };rows: { values: { userEnteredValue: { stringValue: string } }[] }[];fields: string } }[];
    for (const { updateCells: update } of requests) {
      if (update.fields !== "userEnteredValue") throw new Error("Unexpected field mask");
      const sheet = sheets.find((sheet) => sheet.properties.sheetId === update.range.sheetId)!;
      const row = sheet.data![0]!.rowData![update.range.startRowIndex]!;
      const column = update.range.startColumnIndex;
      row.values![column] = { ...row.values![column],userEnteredValue: update.rows[0]!.values[0]!.userEnteredValue,formattedValue: update.rows[0]!.values[0]!.userEnteredValue.stringValue };
    }
    await writeFile("var/e2e/writebacks.json",JSON.stringify({ before,after: sheets,requests }));
    return {};
  }
  return structuredClone({ spreadsheetId: "synthetic",sheets });
} } as SheetsExecutor;
const reader = new GoogleSheetsReader(api);
await startServer(process.env,reader,new GoogleSheetsWriter(api));
