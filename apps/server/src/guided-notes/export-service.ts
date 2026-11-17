import ExcelJS from "exceljs";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RuntimePaths } from "../config/runtime-paths.js";
import { ActivityRepository, ExportRecordRepository, QuestionRepository } from "../db/repositories/index.js";
import { RepositoryError } from "../db/repositories/errors.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";
import { assertExportSemantics, assertWorkbookMappings } from "./export-validation.js";

interface WinnerRow { question_id: string; answer: string }

export interface GuidedNotesExport {
  id: string;
  filename: string;
  outputPath: string;
  sha256: string;
  buffer: Buffer;
}

export interface ExportServiceOptions {
  clock?: () => string;
  idFactory?: () => string;
  beforeValidation?: (path: string) => Promise<void>;
}

function sha256(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }

export class GuidedNotesExportService {
  private readonly activities: ActivityRepository;
  private readonly questions: QuestionRepository;
  private readonly records: ExportRecordRepository;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: Database.Database,
    private readonly runtimePaths: RuntimePaths,
    private readonly options: ExportServiceOptions = {},
  ) {
    this.activities = new ActivityRepository(database);
    this.questions = new QuestionRepository(database);
    this.records = new ExportRecordRepository(database);
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async export(activityId: string): Promise<GuidedNotesExport> {
    const activity = this.activities.getById(activityId);
    if (activity.state !== "CLOSED") throw new AppError(409, "ACTIVITY_NOT_CLOSED", "活動結束後才能匯出 Guided Notes。");
    const questions = this.questions.listByActivity(activityId);
    if (activity.sourceKind !== "legacy-xlsx" || !activity.sourceFilePath || !activity.sourceSha256) throw new AppError(409, "SOURCE_TYPE_UNSUPPORTED", "雲端來源不提供 XLSX 匯出。");
    const sourceBuffer = await this.readVerifiedSource(activity.sourceFilePath, activity.sourceSha256);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(sourceBuffer).buffer);
    assertWorkbookMappings(workbook, questions);

    const winners = this.database.prepare(
      `SELECT result.question_id, attempt.answer
       FROM result_entries AS result
       JOIN submission_attempts AS attempt ON attempt.id = result.attempt_id
       WHERE result.activity_id = ? AND result.rank = 1`,
    ).all(activityId) as WinnerRow[];
    const winnerByQuestion = new Map(winners.map((winner) => [winner.question_id, winner.answer]));
    for (const question of questions) {
      const answer = winnerByQuestion.get(question.id);
      if (answer === undefined) continue;
      const sheet = workbook.getWorksheet(question.sheetName);
      if (!sheet) throw new AppError(422, "EXPORT_MAPPING_MISMATCH", `找不到 mapping 指定的工作表：${question.sheetName}。`);
      sheet.getCell(question.answerAnchor).value = answer;
    }

    const id = this.idFactory();
    const directory = join(this.runtimePaths.exports, activityId);
    const outputPath = join(directory, `${id}.xlsx`);
    const temporaryPath = join(directory, `.${id}.tmp.xlsx`);
    await mkdir(directory, { recursive: true });
    try {
      await workbook.xlsx.writeFile(temporaryPath);
      await this.options.beforeValidation?.(temporaryPath);
      const outputWorkbook = new ExcelJS.Workbook();
      await outputWorkbook.xlsx.readFile(temporaryPath);
      assertExportSemantics(workbook, outputWorkbook, questions);
      const outputBuffer = await readFile(temporaryPath);
      const sourceAfter = await readFile(activity.sourceFilePath);
      if (sha256(sourceAfter) !== activity.sourceSha256) throw new AppError(422, "SOURCE_FILE_MISMATCH", "保存的原始 Guided Notes 已變更，已停止匯出。");
      await rename(temporaryPath, outputPath);
      const digest = sha256(outputBuffer);
      try {
        this.records.create({ id, activityId, outputPath, sha256: digest, createdAt: this.clock() });
      } catch (error) {
        await rm(outputPath, { force: true });
        throw error;
      }
      return { id, filename: `${basename(activity.sourceFilePath, ".xlsx")}-搶答結果.xlsx`, outputPath, sha256: digest, buffer: outputBuffer };
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (error instanceof AppError) throw error;
      if (error instanceof RepositoryError) throw repositoryErrorToAppError(error);
      throw error;
    }
  }

  private async readVerifiedSource(path: string, expectedHash: string): Promise<Buffer> {
    try {
      const buffer = await readFile(path);
      if (sha256(buffer) !== expectedHash) throw new AppError(422, "SOURCE_FILE_MISMATCH", "保存的原始 Guided Notes 已遺失或內容不一致，無法匯出。");
      return buffer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(422, "SOURCE_FILE_UNAVAILABLE", "找不到匯入時保存的原始 Guided Notes，無法匯出。");
    }
  }
}
