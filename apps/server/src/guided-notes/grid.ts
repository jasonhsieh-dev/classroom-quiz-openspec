/** Read-only parser boundary shared by ExcelJS and cloud grids. Coordinates are 1-based here. */
export interface GridCell {
  address: string;
  text: string;
  value: unknown;
  style: object;
  isMerged: boolean;
  master: { address: string };
}
export interface GridWorksheet {
  name: string;
  rowCount: number;
  model: { merges?: string[] };
  getCell(row: number, column: number): GridCell;
  getRow(row: number): { eachCell(options: { includeEmpty: boolean }, callback: (cell: GridCell, column: number) => void): void };
  validBlankAnswer?(row: number, column: number): boolean;
}
export interface GridWorkbook { worksheets: GridWorksheet[] }
export function cellAddress(row: number, column: number): string {
  let letters = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  }
  return `${letters}${row}`;
}
