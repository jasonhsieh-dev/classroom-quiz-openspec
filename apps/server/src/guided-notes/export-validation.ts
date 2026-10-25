import type ExcelJS from "exceljs";
import type { QuestionRecord } from "../db/repositories/index.js";
import { AppError } from "../errors.js";
import { parseGuidedNotesWorkbook } from "./parser.js";
import { captureWorkbookSemantics, compareWorkbookSemantics } from "./workbook-semantics.js";

function mappingKey(mapping: Pick<QuestionRecord, "displayNumber" | "sheetName" | "numberCell" | "answerRange" | "answerAnchor">): string {
  return [mapping.displayNumber, mapping.sheetName, mapping.numberCell, mapping.answerRange, mapping.answerAnchor].join("\u0000");
}

export function assertWorkbookMappings(workbook: ExcelJS.Workbook, questions: QuestionRecord[]): void {
  const parsed = parseGuidedNotesWorkbook(workbook);
  const expected = questions.map(mappingKey).sort();
  const actual = parsed.map(mappingKey).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new AppError(422, "EXPORT_MAPPING_MISMATCH", "匯出檔的題目與答案位置不再符合匯入時的 mapping，已停止下載。", { expected, actual });
  }
}

export function assertExportSemantics(
  expectedWorkbook: ExcelJS.Workbook,
  outputWorkbook: ExcelJS.Workbook,
  questions: QuestionRecord[],
): void {
  const differences = compareWorkbookSemantics(
    captureWorkbookSemantics(expectedWorkbook),
    captureWorkbookSemantics(outputWorkbook),
  );
  if (differences.length > 0) {
    throw new AppError(422, "EXPORT_SEMANTIC_MISMATCH", "匯出檔未能完整保留原始活頁簿，已停止下載。", { differences });
  }
  assertWorkbookMappings(outputWorkbook, questions);
}
