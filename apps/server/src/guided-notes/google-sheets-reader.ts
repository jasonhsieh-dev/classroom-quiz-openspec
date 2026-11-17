import { createHash } from "node:crypto";
import type { SessionRecord } from "../db/repositories/session-repository.js";
import { AppError } from "../errors.js";
import { cellAddress, type GridWorksheet, type GridCell } from "./grid.js";
import { GoogleSheetsAuthorization } from "./google-sheets-authorization.js";
import { parseGuidedNotesWorkbook } from "./parser.js";

export interface EnteredValue { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string }
export interface CloudCell {
  userEnteredValue?: EnteredValue;
  effectiveValue?: EnteredValue;
  formattedValue?: string;
  userEnteredFormat?: Record<string, unknown>;
  effectiveFormat?: Record<string, unknown>;
}
export interface CloudRange { sheetId?: number; startRowIndex?: number; endRowIndex: number; startColumnIndex?: number; endColumnIndex: number }
export interface SheetProperties { sheetId: number; title: string; sheetType?: string; gridProperties: { rowCount: number; columnCount: number } }
export interface CloudSheet {
  properties: SheetProperties;
  merges?: CloudRange[];
  data?: { startRow?: number; startColumn?: number; rowData?: { values?: CloudCell[] }[] }[];
}
interface Spreadsheet { spreadsheetId: string; sheets?: CloudSheet[] }
export interface SheetsExecutor { execute<T>(session: SessionRecord, input: Parameters<GoogleSheetsAuthorization["execute"]>[1]): Promise<T> }
const maxCells = 100_000;
const maxBytes = 4_000_000;
function invalid(message = "Google Sheets 回應或網格範圍無效。") { return new AppError(422, "GOOGLE_GRID_INVALID", message); }
export function parseGoogleSheetsUrl(input: string): { spreadsheetId: string; sheetId?: number } {
  try {
    const url = new URL(input);
    const match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/(?:edit|view|preview))?\/?$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.port || url.username || url.password || !match) throw new Error();
    const gids = [...url.searchParams.getAll("gid"), ...new URLSearchParams(url.hash.slice(1)).getAll("gid")];
    if (gids.some((gid) => !/^\d+$/.test(gid) || !Number.isSafeInteger(Number(gid))) || new Set(gids).size > 1) throw new Error();
    return { spreadsheetId: match[1]!, ...(gids[0] !== undefined ? { sheetId: Number(gids[0]) } : {}) };
  } catch { throw new AppError(400, "GOOGLE_URL_INVALID", "請提供有效的 Google Sheets 文件網址。"); }
}
function checkProperties(p: SheetProperties): void {
  if (!p || !Number.isSafeInteger(p.sheetId) || p.sheetId < 0 || typeof p.title !== "string" || !p.title ||
      !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount <= 0 ||
      !Number.isSafeInteger(p.gridProperties?.columnCount) || p.gridProperties.columnCount <= 0 ||
      (p.sheetType !== undefined && p.sheetType !== "GRID")) throw invalid();
}
function text(cell: CloudCell): string {
  const value = cell.effectiveValue ?? cell.userEnteredValue;
  return cell.formattedValue ?? (value?.stringValue ?? (value?.numberValue !== undefined ? String(value.numberValue) : value?.boolValue !== undefined ? String(value.boolValue) : ""));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }

export class CloudGrid implements GridWorksheet {
  readonly name: string;
  readonly rowCount: number;
  readonly model: { merges: string[] };
  readonly cells = new Map<string, CloudCell>();
  readonly ranges: { top: number; bottom: number; left: number; right: number }[];
  constructor(readonly properties: SheetProperties, sheet: CloudSheet) {
    checkProperties(properties);
    this.name = properties.title; this.rowCount = properties.gridProperties.rowCount;
    const columns = properties.gridProperties.columnCount;
    if (this.rowCount * columns > maxCells) throw new AppError(413, "GOOGLE_GRID_TOO_LARGE", "所選分頁超過 100000 格掃描上限，請縮小分頁。");
    this.ranges = (sheet.merges ?? []).map((range) => {
      const top = (range.startRowIndex ?? 0) + 1, left = (range.startColumnIndex ?? 0) + 1;
      const bottom = range.endRowIndex, right = range.endColumnIndex;
      if ((range.sheetId ?? properties.sheetId) !== properties.sheetId || ![top,left,bottom,right].every(Number.isSafeInteger) || top < 1 || left < 1 || bottom < top || right < left || bottom > this.rowCount || right > columns) throw invalid();
      return { top, left, bottom, right };
    });
    for (let i = 0; i < this.ranges.length; i++) for (let j = 0; j < i; j++) {
      const a = this.ranges[i]!, b = this.ranges[j]!;
      if (a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right) throw invalid("合併範圍互相重疊。");
    }
    this.model = { merges: this.ranges.map((r) => `${cellAddress(r.top,r.left)}:${cellAddress(r.bottom,r.right)}`).sort() };
    for (const block of sheet.data ?? []) {
      const startRow = block.startRow ?? 0, startColumn = block.startColumn ?? 0;
      if (![startRow,startColumn].every((v) => Number.isSafeInteger(v) && v >= 0)) throw invalid();
      for (const [ri, row] of (block.rowData ?? []).entries()) for (const [ci, cell] of (row.values ?? []).entries()) {
        const r = startRow + ri + 1, c = startColumn + ci + 1;
        if (r > this.rowCount || c > columns) throw invalid();
        const address = cellAddress(r,c);
        if (this.cells.has(address)) throw invalid("重複的網格資料區塊。");
        this.cells.set(address, cell);
      }
    }
  }
  raw(row: number, column: number): CloudCell { return this.cells.get(cellAddress(row,column)) ?? {}; }
  getCell(row: number, column: number): GridCell {
    const range = this.ranges.find((r) => row >= r.top && row <= r.bottom && column >= r.left && column <= r.right);
    const cell = this.raw(range?.top ?? row, range?.left ?? column);
    return { address: cellAddress(row,column), text: text(cell), value: cell.userEnteredValue ?? null,
      style: cell.userEnteredFormat ?? cell.effectiveFormat ?? {}, isMerged: Boolean(range),
      master: { address: cellAddress(range?.top ?? row,range?.left ?? column) } };
  }
  getRow(row: number) { return { eachCell: (_options: { includeEmpty: boolean }, visit: (cell: GridCell, column: number) => void) => {
    for (let c = 1; c <= this.properties.gridProperties.columnCount; c++) {
      const cell = this.getCell(row,c); if (cell.text) visit(cell,c);
    }
  } }; }
  validBlankAnswer(row: number, column: number): boolean {
    // Only invoked by the parser after a unique header and a numbered, nonempty prompt row.
    return row >= 1 && row <= this.rowCount && column >= 1 && column <= this.properties.gridProperties.columnCount;
  }
}
export class GoogleSheetsReader {
  constructor(private readonly api: SheetsExecutor = new GoogleSheetsAuthorization()) {}
  async listSheets(session: SessionRecord, url: string): Promise<{ spreadsheetId: string; sheets: SheetProperties[] }> {
    const { spreadsheetId } = parseGoogleSheetsUrl(url);
    const result = await this.api.execute<Spreadsheet>(session, { spreadsheetId, action: "get", fields: "spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))" });
    if (result.spreadsheetId !== spreadsheetId || !result.sheets?.length) throw invalid();
    const sheets = result.sheets.map((s) => s.properties);
    sheets.forEach(checkProperties);
    if (new Set(sheets.map((s) => s.sheetId)).size !== sheets.length) throw invalid();
    return { spreadsheetId, sheets };
  }
  async read(session: SessionRecord, url: string, sheetId: number) {
    const { spreadsheetId, sheets } = await this.listSheets(session,url);
    const properties = sheets.find((s) => s.sheetId === sheetId);
    if (!properties) throw new AppError(400, "GOOGLE_SHEET_NOT_FOUND", "請選擇文件內有效的單一分頁。");
    if (properties.gridProperties.rowCount * properties.gridProperties.columnCount > maxCells) throw new AppError(413, "GOOGLE_GRID_TOO_LARGE", "所選分頁超過掃描上限，請縮小分頁。");
    const range = `'${properties.title.replaceAll("'", "''")}'!A1:${cellAddress(properties.gridProperties.rowCount,properties.gridProperties.columnCount)}`;
    const result = await this.api.execute<Spreadsheet>(session, { spreadsheetId, action: "get", ranges: [range], fields: "spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),merges,data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,userEnteredFormat,effectiveFormat))))" });
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw new AppError(413, "GOOGLE_GRID_TOO_LARGE", "雲端資料超過大小限制。");
    const sheet = result.sheets?.find((s) => s.properties.sheetId === sheetId);
    if (result.spreadsheetId !== spreadsheetId || !sheet || fingerprint(sheet.properties) !== fingerprint(properties)) throw invalid("讀取期間分頁結構改變，請重試。");
    const grid = new CloudGrid(properties,sheet);
    const mappings = parseGuidedNotesWorkbook({ worksheets: [grid] });
    // Reject answers overlapping any question number/prompt, including cross-column merges.
    function rectangle(address: string) {
      const [start,end = start] = address.split(":");
      const coordinate = (value: string) => {
        const match = /^([A-Z]+)([0-9]+)$/.exec(value)!;
        return { row: Number(match[2]), column: [...match[1]!].reduce((n,c) => n*26+c.charCodeAt(0)-64,0) };
      };
      return { start: coordinate(start!), end: coordinate(end!) };
    }
    const occupied = mappings.flatMap((m) => [rectangle(m.numberCell),rectangle(m.promptRange)]);
    const headerAddresses = new Set<string>();
    for (let row = 1; row <= grid.rowCount; row++) {
      const headerCells: string[] = [];
      const labels = new Set<string>();
      grid.getRow(row).eachCell({ includeEmpty: false },(cell) => {
        const label = cell.text.normalize("NFKC").trim();
        if (cell.master.address === cell.address && ["題號","題目","作答"].includes(label)) {
          labels.add(label); headerCells.push(cell.address);
        }
      });
      if (labels.size === 3) { occupied.push(...headerCells.map(rectangle)); headerCells.forEach((address) => { headerAddresses.add(address); }); }
    }
    for (const m of mappings) {
      const a = rectangle(m.answerRange);
      if (occupied.some((b) => a.start.row <= b.end.row && b.start.row <= a.end.row &&
          a.start.column <= b.end.column && b.start.column <= a.end.column)) throw invalid("答案範圍與題號或題目重疊。");
    }
    const originalAnswers = mappings.map((m) => ({ anchor: m.answerAnchor, value: grid.cells.get(m.answerAnchor)?.userEnteredValue ?? null }));
    const structure = { sheetId, dimensions: properties.gridProperties, merges: grid.model.merges,
      mappings: mappings.map(({ originalAnswer: _answer, promptText: _text, sheetName: _name, ...m }) => m),
      // Compare source inputs rather than volatile formula results; unrelated answers stay separate.
      inputs: [...grid.cells.entries()].filter(([address,c]) => c.userEnteredValue !== undefined &&
        (mappings.some((m) => m.numberCell === address || m.promptRange.split(":")[0] === address) ||
         headerAddresses.has(address))).map(([address,c]) => [address,c.userEnteredValue]).sort(([a],[b]) => String(a).localeCompare(String(b))) };
    return { spreadsheetId, sheetId, sheetTitle: properties.title, mappings, originalAnswers,
      structureFingerprint: fingerprint(structure), snapshot: { properties, merges: grid.model.merges, cells: [...grid.cells.entries()] } };
  }
}
