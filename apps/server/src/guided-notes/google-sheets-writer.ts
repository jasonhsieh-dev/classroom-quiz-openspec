import type { SessionRecord } from "../db/repositories/session-repository.js";
import { AppError } from "../errors.js";
import { GoogleSheetsAuthorization } from "./google-sheets-authorization.js";
import { fingerprint, type SheetsExecutor } from "./google-sheets-reader.js";
import type { CloudRead, WritebackPlan } from "./google-sheets-writeback-plan.js";

export function writebackBatch(plan: WritebackPlan) {
  if (plan.targets.length > 1000) throw new AppError(413,"WRITEBACK_TOO_LARGE","超過單批寫回上限；已停止，不會拆批寫入。");
  const anchors = new Set<string>();
  const requests = plan.targets.map((target) => {
    const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(target.anchor);
    if (!match || anchors.has(target.anchor)) throw new AppError(422,"WRITEBACK_MAPPING_INVALID","答案 anchor 無效或重複。");
    anchors.add(target.anchor);
    const column = [...match[1]!].reduce((n,c) => n*26+c.charCodeAt(0)-64,0)-1;
    const row = Number(match[2])-1;
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) throw new AppError(422,"WRITEBACK_MAPPING_INVALID","答案座標超出範圍。");
    return { updateCells: { range: { sheetId: plan.sheetId,startRowIndex: row,endRowIndex: row+1,startColumnIndex: column,endColumnIndex: column+1 },
      rows: [{ values: [{ userEnteredValue: { stringValue: target.answer } }] }],fields: "userEnteredValue" } };
  });
  const data = { requests };
  if (Buffer.byteLength(JSON.stringify(data)) > 2_000_000) throw new AppError(413,"WRITEBACK_TOO_LARGE","超過單批寫回大小限制；已停止，不會拆批寫入。");
  return data;
}
/** Compare source input values and explicit formats, never volatile calculated outputs. */
export function protectedSnapshot(snapshot: CloudRead["snapshot"], plan: WritebackPlan) {
  const targets = new Set(plan.targets.map((t) => t.anchor));
  return { properties: snapshot.properties,merges: snapshot.merges,
    cells: snapshot.cells.map(([address,c]) => [address,{
      ...(!targets.has(address) && c.userEnteredValue ? { value: c.userEnteredValue } : {}),
      ...(c.userEnteredFormat && Object.keys(c.userEnteredFormat).length ? { format: c.userEnteredFormat } : {}),
    }] as const).filter(([,c]) => Object.keys(c).length).sort(([a],[b]) => a.localeCompare(b)) };
}
export function verifyWriteback(plan: WritebackPlan, before: CloudRead["snapshot"], after: CloudRead): void {
  if (after.structureFingerprint !== plan.structureFingerprint || after.spreadsheetId !== plan.spreadsheetId || after.sheetId !== plan.sheetId ||
      plan.targets.some((t) => fingerprint(after.originalAnswers.find((a) => a.anchor === t.anchor)?.value ?? null) !== fingerprint({ stringValue: t.answer })) ||
      fingerprint(protectedSnapshot(before,plan)) !== fingerprint(protectedSnapshot(after.snapshot,plan))) {
    throw new AppError(409,"WRITEBACK_VERIFICATION_CONFLICT","寫回後核對發現目標或非目標差異，請檢查文件；不會自動覆原或重送。");
  }
}
export class GoogleSheetsWriter {
  constructor(private readonly api: SheetsExecutor = new GoogleSheetsAuthorization()) {}
  async write(session: SessionRecord, plan: WritebackPlan, beforeUpdate?: () => void): Promise<void> {
    const data = writebackBatch(plan);
    if (data.requests.length) await this.api.execute(session,{ spreadsheetId: plan.spreadsheetId,action: "batchUpdate",data,
      ...(beforeUpdate ? { beforeUpdate } : {}) });
  }
}
