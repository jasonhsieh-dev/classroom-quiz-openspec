import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestDatabase, type TestDatabase } from "../db/test-database.js";
import { ActivityRepository, ExportRecordRepository, GroupRepository, QuestionRepository, SessionRepository } from "../db/repositories/index.js";
import { ActivityStateService } from "../services/activity-state.js";
import { SubmissionService } from "../services/submission-service.js";
import { ActivityCloseService } from "../services/activity-close.js";
import { parseGuidedNotesWorkbook } from "./parser.js";
import { captureWorkbookSemantics, compareWorkbookSemantics } from "./workbook-semantics.js";
import { guidedNotesFixturePath } from "./test-fixtures.js";
import { GuidedNotesExportService } from "./export-service.js";

const databases: TestDatabase[] = [];
afterEach(() => { for (const item of databases.splice(0)) item.cleanup(); });
const now = "2026-10-25T04:00:00.000Z";
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

async function setup(filename: string, state: "DRAFT" | "OPEN" | "CLOSED" = "CLOSED", winnerIndex = 0) {
  const test = createTestDatabase(); databases.push(test);
  const paths = { data: join(test.directory, "data"), uploads: join(test.directory, "uploads"), exports: join(test.directory, "exports") };
  const sourceDirectory = join(paths.uploads, "activities", "a1");
  await mkdir(sourceDirectory, { recursive: true });
  const sourcePath = join(sourceDirectory, "source.xlsx");
  const source = await readFile(guidedNotesFixturePath(filename));
  await writeFile(sourcePath, source);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(sourcePath);
  const mappings = parseGuidedNotesWorkbook(workbook);
  new ActivityRepository(test.database).create({ id: "a1", title: "匯出測試", sourceFilePath: sourcePath, sourceSha256: hash(source), createdAt: now });
  const questions = new QuestionRepository(test.database);
  mappings.forEach((mapping, index) => { questions.create({ id: `q${index + 1}`, activityId: "a1", sortOrder: index, ...mapping }); });
  const groups = new GroupRepository(test.database); groups.create({ id: "g1", activityId: "a1", name: "第一組", createdAt: now });
  const sessions = new SessionRepository(test.database);
  const session = sessions.create({ id: "s1", role: "student", activityId: "a1", groupId: "g1", createdAt: now, expiresAt: "2026-10-26T04:00:00.000Z" });
  if (state !== "DRAFT") {
    new ActivityStateService(test.database, () => now).transition("a1", "OPEN");
    new SubmissionService(test.database, { clock: () => now }).submit(session, { questionId: `q${winnerIndex + 1}`, answer: "成功答案", idempotencyKey: "winner" });
  }
  if (state === "CLOSED") new ActivityCloseService(test.database, () => now).close("a1");
  return { test, paths, source, sourcePath, mappings };
}

describe("Guided Notes 結果匯出", () => {
  for (const filename of ["reference-single-template.xlsx", "synthetic-moved-multiple.xlsx", "synthetic-semantic-rich.xlsx"]) {
    it(`由原始 ${filename} 與動態 mapping 產生保真匯出`, async () => {
      const { test, paths, source, sourcePath, mappings } = await setup(filename);
      const result = await new GuidedNotesExportService(test.database, paths, { idFactory: () => "export-1", clock: () => now }).export("a1");
      expect(await readFile(sourcePath)).toEqual(source);
      const expected = new ExcelJS.Workbook(); await expected.xlsx.readFile(sourcePath);
      expected.getWorksheet(mappings[0]!.sheetName)!.getCell(mappings[0]!.answerAnchor).value = "成功答案";
      const actual = new ExcelJS.Workbook(); await actual.xlsx.readFile(result.outputPath);
      expect(compareWorkbookSemantics(captureWorkbookSemantics(expected), captureWorkbookSemantics(actual))).toEqual([]);
      for (const mapping of mappings) {
        const promptAnchor = mapping.promptRange.split(":")[0]!;
        expect(actual.getWorksheet(mapping.sheetName)!.getCell(promptAnchor).text).toBe(mapping.promptText);
      }
      for (const unanswered of mappings.slice(1)) {
        expect(actual.getWorksheet(unanswered.sheetName)!.getCell(unanswered.answerAnchor).text).toBe(unanswered.originalAnswer ?? "");
      }
      expect(hash(result.buffer)).toBe(result.sha256);
      expect(new ExportRecordRepository(test.database).listByActivity("a1")).toHaveLength(1);
    });
  }

  it("DRAFT、OPEN 均拒絕匯出且不建立紀錄", async () => {
    for (const state of ["DRAFT", "OPEN"] as const) {
      const { test, paths } = await setup("reference-single-template.xlsx", state);
      await expect(new GuidedNotesExportService(test.database, paths).export("a1")).rejects.toMatchObject({ code: "ACTIVITY_NOT_CLOSED" });
      expect(new ExportRecordRepository(test.database).listByActivity("a1")).toEqual([]);
    }
  });

  it("成功題目覆蓋既有答案，未作答題目仍保留原內容", async () => {
    const initial = new ExcelJS.Workbook(); await initial.xlsx.readFile(guidedNotesFixturePath("synthetic-moved-multiple.xlsx"));
    const initialMappings = parseGuidedNotesWorkbook(initial);
    const winnerIndex = initialMappings.findIndex((mapping) => Boolean(mapping.originalAnswer));
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    const { test, paths, mappings } = await setup("synthetic-moved-multiple.xlsx", "CLOSED", winnerIndex);
    const result = await new GuidedNotesExportService(test.database, paths, { idFactory: () => "overwrite" }).export("a1");
    const output = new ExcelJS.Workbook(); await output.xlsx.readFile(result.outputPath);
    expect(output.getWorksheet(mappings[winnerIndex]!.sheetName)!.getCell(mappings[winnerIndex]!.answerAnchor).text).toBe("成功答案");
    mappings.forEach((mapping, index) => {
      if (index !== winnerIndex) expect(output.getWorksheet(mapping.sheetName)!.getCell(mapping.answerAnchor).text).toBe(mapping.originalAnswer ?? "");
    });
  });

  it("每次匯出建立獨立檔案與紀錄", async () => {
    const { test, paths } = await setup("reference-single-template.xlsx");
    let sequence = 0;
    const service = new GuidedNotesExportService(test.database, paths, { idFactory: () => `export-${++sequence}` });
    const first = await service.export("a1"); const second = await service.export("a1");
    expect(first.outputPath).not.toBe(second.outputPath);
    expect(new ExportRecordRepository(test.database).listByActivity("a1")).toHaveLength(2);
  });

  it("原始檔內容與保存雜湊不一致時拒絕匯出", async () => {
    const { test, paths, sourcePath } = await setup("reference-single-template.xlsx");
    await writeFile(sourcePath, "damaged");
    await expect(new GuidedNotesExportService(test.database, paths).export("a1")).rejects.toMatchObject({ code: "SOURCE_FILE_MISMATCH" });
    expect(new ExportRecordRepository(test.database).listByActivity("a1")).toEqual([]);
  });

  it("輸出驗證失敗時刪除暫存檔且不留下可下載檔或紀錄", async () => {
    const { test, paths } = await setup("reference-single-template.xlsx");
    const service = new GuidedNotesExportService(test.database, paths, {
      idFactory: () => "broken",
      beforeValidation: async (path) => {
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(path);
        workbook.worksheets[0]!.getCell("A1").value = "非目標竄改";
        await workbook.xlsx.writeFile(path);
      },
    });
    await expect(service.export("a1")).rejects.toMatchObject({ code: "EXPORT_SEMANTIC_MISMATCH" });
    expect(new ExportRecordRepository(test.database).listByActivity("a1")).toEqual([]);
    await expect(readFile(join(paths.exports, "a1", "broken.xlsx"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
