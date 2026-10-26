import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { loadGuidedNotesFixture } from "./test-fixtures.js";
import {
  captureWorkbookSemantics,
  compareWorkbookSemantics,
} from "./workbook-semantics.js";
import { parseGuidedNotesWorkbook } from "./parser.js";

async function roundTrip(filename: string) {
  const source = await loadGuidedNotesFixture(filename);
  const expected = captureWorkbookSemantics(source);
  const buffer = await source.xlsx.writeBuffer();
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(buffer);
  return {
    expected,
    actual: captureWorkbookSemantics(output),
    sourceMappings: parseGuidedNotesWorkbook(source),
    outputMappings: parseGuidedNotesWorkbook(output),
  };
}

describe("ExcelJS XLSX round-trip 技術驗證", () => {
  it.each([
    "reference-single-template.xlsx",
    "synthetic-moved-multiple.xlsx",
    "synthetic-semantic-rich.xlsx",
  ])("完整保留 %s 的必要語意", async (filename) => {
    const { expected, actual, sourceMappings, outputMappings } = await roundTrip(filename);

    expect(compareWorkbookSemantics(expected, actual)).toEqual([]);
    expect(actual).toEqual(expected);
    expect(outputMappings).toEqual(sourceMappings);
  });
});
