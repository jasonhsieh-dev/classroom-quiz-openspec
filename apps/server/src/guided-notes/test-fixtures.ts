import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const guidedNotesFixtureDirectory = fileURLToPath(
  new URL("../../../../tests/fixtures/guided-notes/", import.meta.url),
);

export function guidedNotesFixturePath(filename: string): string {
  return `${guidedNotesFixtureDirectory}${filename}`;
}

export function readGuidedNotesFixture(filename: string): Promise<Buffer> {
  return readFile(guidedNotesFixturePath(filename));
}

export async function loadGuidedNotesFixture(
  filename: string,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(guidedNotesFixturePath(filename));
  return workbook;
}
