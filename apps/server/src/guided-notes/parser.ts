import type { GridCell, GridWorksheet, GridWorkbook } from "./grid.js";
import { GuidedNotesError } from "./errors.js";

export interface GuidedNotesQuestionMapping {
  displayNumber: string;
  promptText: string;
  promptRange: string;
  sheetName: string;
  numberCell: string;
  answerRange: string;
  answerAnchor: string;
  originalAnswer: string | null;
}

export interface GuidedNotesPreviewQuestion extends GuidedNotesQuestionMapping {
  willOverwrite: boolean;
}

export interface GuidedNotesPreview {
  questionCount: number;
  questions: GuidedNotesPreviewQuestion[];
}

interface HeaderCandidate {
  worksheet: GridWorksheet;
  headerRow: number;
  numberColumn: number;
  promptColumn: number;
  answerColumn: number;
}

interface CellRange {
  address: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim();
}

function isMergeSlave(cell: GridCell): boolean {
  return cell.isMerged && cell.master.address !== cell.address;
}

function scanHeaderCandidates(workbook: GridWorkbook): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];

  for (const worksheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const numberColumns: number[] = [];
      const promptColumns: number[] = [];
      const answerColumns: number[] = [];

      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (isMergeSlave(cell)) return;
        const text = normalizedText(cell.text);
        if (text === "題號") numberColumns.push(columnNumber);
        if (text === "題目") promptColumns.push(columnNumber);
        if (text === "作答") answerColumns.push(columnNumber);
      });

      if (
        numberColumns.length === 1
        && promptColumns.length === 1
        && answerColumns.length === 1
      ) {
        candidates.push({
          worksheet,
          headerRow: rowNumber,
          numberColumn: numberColumns[0]!,
          promptColumn: promptColumns[0]!,
          answerColumn: answerColumns[0]!,
        });
      } else if (
        numberColumns.length > 0
        && promptColumns.length > 0
        && answerColumns.length > 0
      ) {
        throw new GuidedNotesError(
          "HEADER_AMBIGUOUS",
          "同一表頭列包含重複的「題號」、「題目」或「作答」，無法唯一辨識欄位。",
          { sheetName: worksheet.name, row: rowNumber },
        );
      }
    }
  }

  return candidates;
}

function columnNumberFromLetters(letters: string): number {
  return [...letters.toUpperCase()].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function parseCellAddress(address: string): { row: number; column: number } {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address);
  if (!match) {
    throw new GuidedNotesError(
      "INVALID_ANSWER_MAPPING",
      `無法解析儲存格位置 ${address}。`,
    );
  }
  return {
    column: columnNumberFromLetters(match[1]!),
    row: Number(match[2]),
  };
}

function parseRangeAddress(address: string): CellRange {
  const [startAddress, endAddress = startAddress] = address.split(":");
  const start = parseCellAddress(startAddress!);
  const end = parseCellAddress(endAddress!);
  return {
    address,
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

function rangeContains(range: CellRange, row: number, column: number): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  );
}

function rangesOverlap(left: CellRange, right: CellRange): boolean {
  return !(
    left.endRow < right.startRow ||
    right.endRow < left.startRow ||
    left.endColumn < right.startColumn ||
    right.endColumn < left.startColumn
  );
}

function mergedRangeAt(
  worksheet: GridWorksheet,
  row: number,
  column: number,
): CellRange | undefined {
  const matches = (worksheet.model.merges ?? [])
    .map(parseRangeAddress)
    .filter((range) => rangeContains(range, row, column));
  if (matches.length > 1) {
    throw new GuidedNotesError(
      "INVALID_ANSWER_MAPPING",
      "答案儲存格同時落在多個合併範圍。",
      { sheetName: worksheet.name, row, column },
    );
  }
  return matches[0];
}

function originalAnswerText(cell: GridCell): string | null {
  if (cell.value === null || cell.value === undefined) return null;
  return cell.text;
}

function hasCellStyle(cell: GridCell): boolean {
  return Object.keys(cell.style).length > 0;
}

function createMapping(
  candidate: HeaderCandidate,
  rowNumber: number,
): {
  mapping: GuidedNotesQuestionMapping;
  answerRange: CellRange;
  promptRange: CellRange;
} {
  const numberCell = candidate.worksheet.getCell(
    rowNumber,
    candidate.numberColumn,
  );
  const promptCell = candidate.worksheet.getCell(
    rowNumber,
    candidate.promptColumn,
  );
  const answerCell = candidate.worksheet.getCell(
    rowNumber,
    candidate.answerColumn,
  );
  const mergedAnswerRange = mergedRangeAt(
    candidate.worksheet,
    rowNumber,
    candidate.answerColumn,
  );

  if (!mergedAnswerRange && answerCell.value == null && !hasCellStyle(answerCell) && !candidate.worksheet.validBlankAnswer?.(rowNumber, candidate.answerColumn)) {
    throw new GuidedNotesError(
      "INVALID_ANSWER_MAPPING",
      `題號 ${numberCell.text.trim()} 缺少可辨識的答案儲存格。`,
      {
        sheetName: candidate.worksheet.name,
        row: rowNumber,
        displayNumber: numberCell.text.trim(),
      },
    );
  }

  const answerRange = mergedAnswerRange ?? parseRangeAddress(answerCell.address);
  const answerAnchorCell = candidate.worksheet.getCell(
    answerRange.startRow,
    answerRange.startColumn,
  );
  const promptRange = mergedRangeAt(
    candidate.worksheet,
    rowNumber,
    candidate.promptColumn,
  ) ?? parseRangeAddress(promptCell.address);
  const promptAnchorCell = candidate.worksheet.getCell(
    promptRange.startRow,
    promptRange.startColumn,
  );
  const promptText = promptAnchorCell.text.trim();
  if (!promptText) {
    throw new GuidedNotesError(
      "INVALID_PROMPT",
      `題號 ${numberCell.text.trim()} 缺少非空的完整題目文字。`,
      {
        sheetName: candidate.worksheet.name,
        row: rowNumber,
        displayNumber: numberCell.text.trim(),
        promptRange: promptRange.address,
      },
    );
  }
  return {
    mapping: {
      displayNumber: numberCell.text.trim(),
      promptText,
      promptRange: promptRange.address,
      sheetName: candidate.worksheet.name,
      numberCell: numberCell.address,
      answerRange: answerRange.address,
      answerAnchor: answerAnchorCell.address,
      originalAnswer: originalAnswerText(answerAnchorCell),
    },
    answerRange,
    promptRange,
  };
}

export function parseGuidedNotesWorkbook(
  workbook: GridWorkbook,
): GuidedNotesQuestionMapping[] {
  const candidates = scanHeaderCandidates(workbook);
  if (candidates.length === 0) {
    throw new GuidedNotesError(
      "HEADER_NOT_FOUND",
      "找不到同一列中的「題號」、「題目」與「作答」表頭。",
    );
  }
  if (candidates.length !== 1) {
    throw new GuidedNotesError(
      "HEADER_AMBIGUOUS",
      "找到多組「題號」與「作答」表頭，無法唯一辨識學習單。",
      {
        candidates: candidates.map((candidate) => ({
          sheetName: candidate.worksheet.name,
          row: candidate.headerRow,
        })),
      },
    );
  }

  const candidate = candidates[0]!;
  const seenNumbers = new Map<string, string>();
  const mappings: GuidedNotesQuestionMapping[] = [];
  const answerRanges: Array<{ range: CellRange; displayNumber: string }> = [];
  const promptRanges: Array<{ range: CellRange; displayNumber: string }> = [];

  for (
    let rowNumber = candidate.headerRow + 1;
    rowNumber <= candidate.worksheet.rowCount;
    rowNumber += 1
  ) {
    const numberCell = candidate.worksheet.getCell(
      rowNumber,
      candidate.numberColumn,
    );
    const displayNumber = numberCell.text.trim();
    if (!displayNumber) continue;

    const normalizedNumber = normalizedText(displayNumber);
    const previous = seenNumbers.get(normalizedNumber);
    if (previous) {
      throw new GuidedNotesError(
        "DUPLICATE_QUESTION_NUMBER",
        `題號 ${displayNumber} 重複。`,
        { displayNumber, firstCell: previous, duplicateCell: numberCell.address },
      );
    }

    const { mapping, answerRange, promptRange } = createMapping(
      candidate,
      rowNumber,
    );
    const overlap = answerRanges.find((existing) =>
      rangesOverlap(existing.range, answerRange),
    );
    if (overlap) {
      throw new GuidedNotesError(
        "OVERLAPPING_ANSWER_RANGES",
        `題號 ${mapping.displayNumber} 與 ${overlap.displayNumber} 的答案範圍重疊。`,
        {
          displayNumber: mapping.displayNumber,
          answerRange: answerRange.address,
          overlapsWith: overlap.displayNumber,
          overlappingRange: overlap.range.address,
        },
      );
    }
    const sharedPrompt = promptRanges.find((existing) =>
      rangesOverlap(existing.range, promptRange),
    );
    if (sharedPrompt) {
      throw new GuidedNotesError(
        "AMBIGUOUS_PROMPT_MAPPING",
        `題號 ${mapping.displayNumber} 與 ${sharedPrompt.displayNumber} 共用或重疊題目範圍，無法唯一定位完整題目。`,
        {
          displayNumber: mapping.displayNumber,
          promptRange: promptRange.address,
          overlapsWith: sharedPrompt.displayNumber,
          overlappingRange: sharedPrompt.range.address,
          sheetName: candidate.worksheet.name,
          row: rowNumber,
        },
      );
    }

    seenNumbers.set(normalizedNumber, numberCell.address);
    mappings.push(mapping);
    answerRanges.push({ range: answerRange, displayNumber: mapping.displayNumber });
    promptRanges.push({ range: promptRange, displayNumber: mapping.displayNumber });
  }

  if (mappings.length === 0) {
    throw new GuidedNotesError(
      "NO_QUESTIONS",
      "表頭下方沒有可建立的題目。",
    );
  }

  return mappings;
}

export function createGuidedNotesPreview(
  mappings: GuidedNotesQuestionMapping[],
): GuidedNotesPreview {
  return {
    questionCount: mappings.length,
    questions: mappings.map((mapping) => ({
      ...mapping,
      willOverwrite: Boolean(mapping.originalAnswer?.trim()),
    })),
  };
}
