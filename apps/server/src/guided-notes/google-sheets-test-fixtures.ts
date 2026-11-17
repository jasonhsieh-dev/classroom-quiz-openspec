import { vi } from "vitest";
import { GoogleSheetsReader, type CloudSheet, type CloudCell, type SheetsExecutor } from "./google-sheets-reader.js";
import type { SessionRecord } from "../db/repositories/session-repository.js";
export const teacher: SessionRecord = { id: "t", role: "teacher", activityId: null, groupId: null, createdAt: "now", expiresAt: "2099-01-01" };
export const url = "https://docs.google.com/spreadsheets/d/synthetic/edit#gid=0";
const cell = (value: string): CloudCell => ({ userEnteredValue: { stringValue: value }, formattedValue: value });
export function sheet(): CloudSheet { return { properties: { sheetId: 0, title: "Notes' 中文", gridProperties: { rowCount: 10, columnCount: 6 } }, data: [{ startRow: 2, startColumn: 1, rowData: [
  { values: [cell("題目"),cell("作答"),cell("題號")] },
  { values: [cell("單題"),{},cell("1")] },
  { values: [cell("題組子題甲"),{},cell("2-1")] },
  { values: [cell("題組子題乙"),{},cell("2-2")] },
] }] }; }
export function setup(source = sheet()) {
  const execute = vi.fn(async (_session, input) => ({ spreadsheetId: "synthetic", sheets: input.ranges ? [source] : [source, { properties: { sheetId: 8, title: "其他分頁", gridProperties: { rowCount: 2, columnCount: 3 } } }] }));
  const reader = new GoogleSheetsReader({ execute } as SheetsExecutor);
  return { reader, execute, source };
}
