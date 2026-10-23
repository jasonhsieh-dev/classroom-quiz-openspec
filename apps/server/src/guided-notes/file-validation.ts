import ExcelJS from "exceljs";
import { extname } from "node:path";
import { GuidedNotesError } from "./errors.js";

export const DEFAULT_MAX_GUIDED_NOTES_BYTES = 10 * 1024 * 1024;

const acceptedMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

export interface GuidedNotesFileInput {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}

export interface GuidedNotesFileOptions {
  maxBytes?: number;
}

function hasZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

export async function loadGuidedNotesWorkbook(
  input: GuidedNotesFileInput,
  options: GuidedNotesFileOptions = {},
): Promise<ExcelJS.Workbook> {
  if (extname(input.filename).toLocaleLowerCase("en-US") !== ".xlsx") {
    throw new GuidedNotesError(
      "INVALID_FILE_TYPE",
      "只接受副檔名為 .xlsx 的 Guided Notes。",
    );
  }

  if (input.mimeType && !acceptedMimeTypes.has(input.mimeType)) {
    throw new GuidedNotesError(
      "INVALID_FILE_TYPE",
      "上傳檔案的 MIME 類型不是 XLSX。",
    );
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_GUIDED_NOTES_BYTES;
  if (input.buffer.byteLength > maxBytes) {
    throw new GuidedNotesError(
      "FILE_TOO_LARGE",
      `Guided Notes 超過允許的 ${maxBytes} bytes。`,
      { maxBytes, actualBytes: input.buffer.byteLength },
    );
  }

  if (!hasZipSignature(input.buffer)) {
    throw new GuidedNotesError(
      "INVALID_XLSX",
      "檔案內容不是有效的 XLSX。",
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(input.buffer).buffer);
  } catch (error) {
    throw new GuidedNotesError(
      "INVALID_XLSX",
      "無法解析 XLSX Guided Notes。",
      undefined,
      { cause: error },
    );
  }
  return workbook;
}
