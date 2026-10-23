import type ExcelJS from "exceljs";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface SemanticCell {
  address: string;
  value: JsonValue;
  style: JsonValue;
}

interface SemanticRow {
  number: number;
  height: number | null;
  hidden: boolean;
}

interface SemanticColumn {
  number: number;
  width: number | null;
  hidden: boolean;
}

export interface SemanticWorksheet {
  name: string;
  state: string;
  merges: string[];
  rows: SemanticRow[];
  columns: SemanticColumn[];
  cells: SemanticCell[];
}

export interface SemanticWorkbook {
  worksheets: SemanticWorksheet[];
}

function normalizeJson(value: unknown, omitFalse = false): JsonValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isNaN(value) ? "NaN" : value;
  }
  if (Array.isArray(value))
    return value.map((entry) => normalizeJson(entry, omitFalse));
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (entry !== undefined && !(omitFalse && entry === false)) {
        result[key] = normalizeJson(entry, omitFalse);
      }
    }
    return result;
  }
  return String(value);
}

function semanticCell(cell: ExcelJS.Cell): SemanticCell {
  return {
    address: cell.address,
    value: normalizeJson(cell.value),
    style: normalizeJson(cell.style, true),
  };
}

function hasCellStyle(cell: ExcelJS.Cell): boolean {
  return Object.keys(cell.style).length > 0;
}

function semanticWorksheet(worksheet: ExcelJS.Worksheet): SemanticWorksheet {
  const rows: SemanticRow[] = [];
  const cells: SemanticCell[] = [];
  const maximumColumn = Math.max(
    worksheet.columnCount,
    worksheet.columns.length,
  );

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (row.height !== undefined || row.hidden) {
      rows.push({
        number: rowNumber,
        height: row.height ?? null,
        hidden: Boolean(row.hidden),
      });
    }
    for (let column = 1; column <= maximumColumn; column += 1) {
      const cell = row.getCell(column);
      if (cell.value != null || hasCellStyle(cell) || cell.isMerged) {
        cells.push(semanticCell(cell));
      }
    }
  }

  const columns = worksheet.columns.flatMap((column, index) =>
    column.width !== undefined || column.hidden
      ? [
          {
            number: index + 1,
            width: column.width ?? null,
            hidden: Boolean(column.hidden),
          },
        ]
      : [],
  );

  return {
    name: worksheet.name,
    state: worksheet.state,
    merges: [...(worksheet.model.merges ?? [])].sort(),
    rows,
    columns,
    cells,
  };
}

export function captureWorkbookSemantics(
  workbook: ExcelJS.Workbook,
): SemanticWorkbook {
  return { worksheets: workbook.worksheets.map(semanticWorksheet) };
}

export function compareWorkbookSemantics(
  expected: SemanticWorkbook,
  actual: SemanticWorkbook,
): string[] {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return [];

  const differences: string[] = [];
  if (expected.worksheets.length !== actual.worksheets.length) {
    differences.push(
      `工作表數量不同：${expected.worksheets.length} != ${actual.worksheets.length}`,
    );
  }
  const count = Math.max(expected.worksheets.length, actual.worksheets.length);
  for (let index = 0; index < count; index += 1) {
    const expectedSheet = expected.worksheets[index];
    const actualSheet = actual.worksheets[index];
    if (!expectedSheet || !actualSheet) continue;
    if (expectedSheet.name !== actualSheet.name)
      differences.push(`工作表順序／名稱不同：${expectedSheet.name} != ${actualSheet.name}`);
    if (expectedSheet.state !== actualSheet.state)
      differences.push(`工作表 ${expectedSheet.name} 隱藏狀態不同`);
    if (JSON.stringify(expectedSheet.merges) !== JSON.stringify(actualSheet.merges))
      differences.push(`工作表 ${expectedSheet.name} 合併範圍不同`);
    if (JSON.stringify(expectedSheet.rows) !== JSON.stringify(actualSheet.rows))
      differences.push(`工作表 ${expectedSheet.name} 列高或隱藏狀態不同`);
    if (JSON.stringify(expectedSheet.columns) !== JSON.stringify(actualSheet.columns))
      differences.push(`工作表 ${expectedSheet.name} 欄寬或隱藏狀態不同`);

    const expectedCells = new Map(expectedSheet.cells.map((cell) => [cell.address, cell]));
    const actualCells = new Map(actualSheet.cells.map((cell) => [cell.address, cell]));
    const addresses = new Set([...expectedCells.keys(), ...actualCells.keys()]);
    for (const address of addresses) {
      if (differences.length >= 20) break;
      const expectedCell = expectedCells.get(address);
      const actualCell = actualCells.get(address);
      if (!expectedCell || !actualCell) {
        differences.push(`工作表 ${expectedSheet.name} 儲存格 ${address} 存在性不同`);
      } else if (JSON.stringify(expectedCell.value) !== JSON.stringify(actualCell.value)) {
        differences.push(`工作表 ${expectedSheet.name} 儲存格 ${address} 值或公式不同`);
      } else if (JSON.stringify(expectedCell.style) !== JSON.stringify(actualCell.style)) {
        differences.push(`工作表 ${expectedSheet.name} 儲存格 ${address} 格式不同`);
      }
    }
  }
  return differences;
}
