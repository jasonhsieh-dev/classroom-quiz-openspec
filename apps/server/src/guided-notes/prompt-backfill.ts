import type Database from "better-sqlite3";
import ExcelJS from "exceljs";
import {
  ActivityRepository,
  QuestionRepository,
  type QuestionRecord,
} from "../db/repositories/index.js";

interface CellRange {
  address: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

interface PromptMetadata {
  questionId: string;
  promptText: string;
  promptRange: string;
}

export interface PromptBackfillFailure {
  activityId: string;
  reason: string;
}

export interface PromptBackfillReport {
  updatedActivityIds: string[];
  unchangedActivityIds: string[];
  failures: PromptBackfillFailure[];
}

class PromptBackfillError extends Error {}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim();
}

function columnNumberFromLetters(letters: string): number {
  return [...letters.toUpperCase()].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function parseCellAddress(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address);
  if (!match) throw new PromptBackfillError(`無法解析儲存格位置 ${address}。`);
  return { column: columnNumberFromLetters(match[1]!), row: Number(match[2]) };
}

function parseRangeAddress(address: string): CellRange {
  const [startAddress, endAddress = startAddress] = address.split(":");
  const start = parseCellAddress(startAddress!);
  const end = parseCellAddress(endAddress!);
  return {
    address: address.replaceAll("$", "").toUpperCase(),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

function rangeContains(range: CellRange, row: number, column: number): boolean {
  return row >= range.startRow && row <= range.endRow
    && column >= range.startColumn && column <= range.endColumn;
}

function mergedRangeAt(
  worksheet: ExcelJS.Worksheet,
  row: number,
  column: number,
): CellRange | undefined {
  const matches = (worksheet.model.merges ?? [])
    .map(parseRangeAddress)
    .filter((range) => rangeContains(range, row, column));
  if (matches.length > 1) {
    throw new PromptBackfillError(
      `工作表 ${worksheet.name} 的儲存格同時位於多個合併範圍。`,
    );
  }
  return matches[0];
}

function headerPromptColumn(
  worksheet: ExcelJS.Worksheet,
  question: QuestionRecord,
): number {
  const numberAddress = parseCellAddress(question.numberCell);
  const answerAddress = parseCellAddress(question.answerAnchor);
  const matches: number[] = [];

  for (let rowNumber = 1; rowNumber < numberAddress.row; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const numberColumns: number[] = [];
    const promptColumns: number[] = [];
    const answerColumns: number[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const text = normalizedText(cell.text);
      if (text === "題號") numberColumns.push(column);
      if (text === "題目") promptColumns.push(column);
      if (text === "作答") answerColumns.push(column);
    });
    if (
      numberColumns.length === 1
      && promptColumns.length === 1
      && answerColumns.length === 1
      && numberColumns[0] === numberAddress.column
      && answerColumns[0] === answerAddress.column
    ) {
      matches.push(promptColumns[0]!);
    }
  }

  if (matches.length !== 1) {
    throw new PromptBackfillError(
      `題號 ${question.displayNumber} 找不到唯一的「題號／題目／作答」表頭。`,
    );
  }
  return matches[0]!;
}

function verifyAnswerMapping(
  worksheet: ExcelJS.Worksheet,
  question: QuestionRecord,
): void {
  const anchor = parseCellAddress(question.answerAnchor);
  const range = mergedRangeAt(worksheet, anchor.row, anchor.column)
    ?? parseRangeAddress(worksheet.getCell(question.answerAnchor).address);
  if (
    range.address !== parseRangeAddress(question.answerRange).address
    || worksheet.getCell(range.startRow, range.startColumn).address
      !== worksheet.getCell(question.answerAnchor).address
  ) {
    throw new PromptBackfillError(
      `題號 ${question.displayNumber} 的答案 mapping 與保存來源不一致。`,
    );
  }
}

function extractPrompt(
  workbook: ExcelJS.Workbook,
  question: QuestionRecord,
): PromptMetadata {
  const worksheet = workbook.getWorksheet(question.sheetName);
  if (!worksheet) {
    throw new PromptBackfillError(`找不到工作表 ${question.sheetName}。`);
  }
  const numberCell = worksheet.getCell(question.numberCell);
  if (normalizedText(numberCell.text) !== normalizedText(question.displayNumber)) {
    throw new PromptBackfillError(
      `題號 ${question.displayNumber} 與 ${question.numberCell} 的來源內容不一致。`,
    );
  }
  verifyAnswerMapping(worksheet, question);

  const numberAddress = parseCellAddress(question.numberCell);
  const promptColumn = headerPromptColumn(worksheet, question);
  const promptRange = mergedRangeAt(worksheet, numberAddress.row, promptColumn)
    ?? parseRangeAddress(worksheet.getCell(numberAddress.row, promptColumn).address);
  const promptCell = worksheet.getCell(promptRange.startRow, promptRange.startColumn);
  const promptText = promptCell.text.trim();
  if (!promptText) {
    throw new PromptBackfillError(`題號 ${question.displayNumber} 缺少完整題目文字。`);
  }
  return { questionId: question.id, promptText, promptRange: promptRange.address };
}

function mappingIdentity(question: QuestionRecord): string {
  return JSON.stringify({
    displayNumber: question.displayNumber,
    sortOrder: question.sortOrder,
    sheetName: question.sheetName,
    numberCell: question.numberCell,
    answerRange: question.answerRange,
    answerAnchor: question.answerAnchor,
    originalAnswer: question.originalAnswer,
  });
}

export async function backfillQuestionPrompts(
  database: Database.Database,
): Promise<PromptBackfillReport> {
  const activities = new ActivityRepository(database);
  const questions = new QuestionRepository(database);
  const report: PromptBackfillReport = {
    updatedActivityIds: [],
    unchangedActivityIds: [],
    failures: [],
  };

  for (const activity of activities.list()) {
    const records = questions.listByActivity(activity.id);
    if (records.length === 0 || records.every((question) => question.promptText && question.promptRange)) {
      report.unchangedActivityIds.push(activity.id);
      continue;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(activity.sourceFilePath);
      const metadata = records.map((question) => extractPrompt(workbook, question));
      const seenRanges = new Set<string>();
      for (const item of metadata) {
        if (seenRanges.has(item.promptRange)) {
          throw new PromptBackfillError(`多個題號共用題目範圍 ${item.promptRange}。`);
        }
        seenRanges.add(item.promptRange);
      }

      database.transaction(() => {
        records.forEach((expected, index) => {
          const current = questions.getById(expected.id);
          if (mappingIdentity(current) !== mappingIdentity(expected)) {
            throw new PromptBackfillError(
              `題號 ${expected.displayNumber} 的保存 mapping 已變更，取消回填。`,
            );
          }
          const item = metadata[index]!;
          questions.updateMetadata(item.questionId, {
            promptText: item.promptText,
            promptRange: item.promptRange,
          });
        });
      })();
      report.updatedActivityIds.push(activity.id);
    } catch (error) {
      report.failures.push({
        activityId: activity.id,
        reason: error instanceof Error ? error.message : "未知的題目回填錯誤。",
      });
    }
  }

  return report;
}
