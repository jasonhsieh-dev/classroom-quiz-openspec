import { describe, expect, it } from "vitest";
import type ExcelJS from "exceljs";
import type { QuestionRecord } from "../db/repositories/index.js";
import { assertExportSemantics, assertWorkbookMappings } from "./export-validation.js";
import { loadGuidedNotesFixture } from "./test-fixtures.js";
import { parseGuidedNotesWorkbook } from "./parser.js";

async function pair(): Promise<{ expected: ExcelJS.Workbook; actual: ExcelJS.Workbook; questions: QuestionRecord[] }> {
  const expected = await loadGuidedNotesFixture("synthetic-semantic-rich.xlsx");
  const actual = await loadGuidedNotesFixture("synthetic-semantic-rich.xlsx");
  const questions = parseGuidedNotesWorkbook(expected).map((mapping, index) => ({
    id: `q${index}`,
    activityId: "a1",
    sortOrder: index,
    ...mapping,
  }));
  return { expected, actual, questions };
}

describe("完整活頁簿語意驗證", () => {
  it("阻擋非目標值、公式、格式、合併、尺寸與隱藏狀態的任何變動", async () => {
    const corruptions: Array<(workbook: ExcelJS.Workbook) => void> = [
      (workbook) => { workbook.worksheets[0]!.getCell("A1").value = "被改動"; },
      (workbook) => {
        let changed = false;
        workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
          if (!changed && cell.value && typeof cell.value === "object" && "formula" in cell.value) { cell.value = { formula: "1+1", result: 2 }; changed = true; }
        })));
        if (!changed) workbook.worksheets[0]!.getCell("Z30").value = { formula: "1+1", result: 2 };
      },
      (workbook) => { workbook.worksheets[0]!.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" } }; },
      (workbook) => { const merge = workbook.worksheets[0]!.model.merges?.[0]; if (merge) workbook.worksheets[0]!.unMergeCells(merge); else workbook.worksheets[0]!.mergeCells("Y20:Z20"); },
      (workbook) => { workbook.worksheets[0]!.getRow(1).height = (workbook.worksheets[0]!.getRow(1).height ?? 15) + 1; },
      (workbook) => { workbook.worksheets[0]!.getColumn(1).width = (workbook.worksheets[0]!.getColumn(1).width ?? 10) + 1; },
      (workbook) => { workbook.worksheets[0]!.getRow(1).hidden = !workbook.worksheets[0]!.getRow(1).hidden; },
      (workbook) => { workbook.worksheets[0]!.getColumn(1).hidden = !workbook.worksheets[0]!.getColumn(1).hidden; },
      (workbook) => { workbook.worksheets[0]!.state = workbook.worksheets[0]!.state === "hidden" ? "visible" : "hidden"; },
    ];
    for (const corrupt of corruptions) {
      const { expected, actual, questions } = await pair(); corrupt(actual);
      expect(() => assertExportSemantics(expected, actual, questions)).toThrowError(expect.objectContaining({ code: "EXPORT_SEMANTIC_MISMATCH" }));
    }
  });

  it("阻擋輸出題號或答案位置偏離保存的 mapping", async () => {
    const { actual, questions } = await pair();
    const wrong = questions.map((question, index) => index === 0 ? { ...question, answerAnchor: "Z99", answerRange: "Z99" } : question);
    expect(() => assertWorkbookMappings(actual, wrong)).toThrowError(expect.objectContaining({ code: "EXPORT_MAPPING_MISMATCH" }));
  });

  it("阻擋題目文字儲存格被匯出流程改寫", async () => {
    const { expected, actual, questions } = await pair();
    const first = questions[0]!;
    const promptAnchor = first.promptRange!.split(":")[0]!;
    actual.getWorksheet(first.sheetName)!.getCell(promptAnchor).value = "被錯誤改寫的題目";
    expect(() => assertExportSemantics(expected, actual, questions)).toThrowError(
      expect.objectContaining({ code: "EXPORT_SEMANTIC_MISMATCH" }),
    );
  });
});
