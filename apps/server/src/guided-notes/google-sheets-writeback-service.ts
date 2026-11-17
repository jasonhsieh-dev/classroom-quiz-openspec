import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { GoogleSheetsWritebackRepository, WritebackOwnershipLost, writebackLeaseMs, type WritebackRow as Row, type WritebackState as State } from "../db/repositories/google-sheets-writeback-repository.js";
import type { SessionRecord } from "../db/repositories/session-repository.js";
import { AppError } from "../errors.js";
import { fingerprint, type GoogleSheetsReader } from "./google-sheets-reader.js";
import { assertTeacher, sourceConflict, type WritebackPlan, type CloudRead, GoogleSheetsWritebackPlanner } from "./google-sheets-writeback-plan.js";
import { GoogleSheetsWriter, protectedSnapshot, verifyWriteback, writebackBatch } from "./google-sheets-writer.js";
interface Stored { plan: WritebackPlan; before: CloudRead["snapshot"]; ownershipToken?: string; singleUpdateAttempted?: boolean; history?: { operationId: string; state: State; errorCode: string | null; updatedAt: string }[] }
const retryable = (error: unknown) => error instanceof AppError && ["GOOGLE_QUOTA_EXCEEDED","GOOGLE_API_FAILED","GOOGLE_CONNECTION_FAILED"].includes(error.code);
const knownRejection = (error: unknown) => error instanceof AppError && ["GOOGLE_AUTH_FAILED","GOOGLE_PERMISSION_DENIED","GOOGLE_DOCUMENT_UNAVAILABLE","GOOGLE_REQUEST_REJECTED","GOOGLE_QUOTA_EXCEEDED","GOOGLE_NOT_CONFIGURED","GOOGLE_CREDENTIALS_INVALID"].includes(error.code);
const safeCode = (error: unknown) => error instanceof AppError ? error.code : "WRITEBACK_INTERNAL_ERROR";
export class GoogleSheetsWritebackService {
  private readonly planner: GoogleSheetsWritebackPlanner;
  private readonly operations: GoogleSheetsWritebackRepository;
  private readonly instanceId = randomUUID();
  constructor(private readonly database: Database.Database,reader: GoogleSheetsReader,
    private readonly writer = new GoogleSheetsWriter(),private readonly now = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve,ms)),
    private readonly singleUpdate = process.env.CLASSROOM_BUZZER_SINGLE_UPDATE === "true") {
    this.planner = new GoogleSheetsWritebackPlanner(database,reader);
    this.operations = new GoogleSheetsWritebackRepository(database);
  }
  runtimeStatus(session: SessionRecord) {
    assertTeacher(session,this.now());
    return { singleUpdateMode: this.singleUpdate,instanceId: this.instanceId };
  }
  private row(activityId: string): Row | undefined {
    return this.operations.find(activityId);
  }
  private stale(row: Row) { return row.state === "IN_FLIGHT" && Date.parse(row.updated_at) + writebackLeaseMs <= this.now().getTime(); }
  private view(plan: WritebackPlan, row?: Row) {
    const state = row ? (this.stale(row) ? "UNKNOWN" : row.state) : plan.targets.length ? "NOT_PREPARED" : "NO_ANSWERS";
    const messages: Record<string,string> = {
      NOT_PREPARED: "待寫回：請先預覽目標與答案。",NO_ANSWERS: "沒有成功答案，無需寫回。",PREPARED: "待寫回：請確認預覽。",
      IN_FLIGHT: "寫回中，請勿重複操作；重新整理可查看狀態。",SUCCEEDED: "寫回成功，已讀回核對。",
      FAILED: "寫回失敗或核對確認尚未寫入；請依錯誤代碼檢查權限、網路或配額，再確認重試。",
      UNKNOWN: "結果不明，請先核對 Google Sheets 狀態；尚不可直接重試。",
      CONFLICT: "來源或核對結果衝突，已停止；請人工檢查文件，不會自動覆原或覆蓋。",
    };
    return { singleUpdateMode: this.singleUpdate,instanceId: this.instanceId,activityId: plan.activityId,operationId: row?.operation_id ?? null,state,
      spreadsheetId: plan.spreadsheetId,sheetId: plan.sheetId,sheetTitle: plan.sheetTitle,resultVersion: plan.resultVersion,
      targets: plan.targets.map(({ displayNumber,anchor,answer,originalValue }) => ({ displayNumber,anchor,answer,originalValue })),
      errorCode: row?.error_code ?? null,canRetry: state === "FAILED" && !(row && (JSON.parse(row.targets_json) as Stored).singleUpdateAttempted),message: messages[state]! };
  }
  status(session: SessionRecord, activityId: string) {
    assertTeacher(session,this.now());const plan = this.planner.build(session,activityId);
    return this.view(plan,this.row(activityId));
  }
  private finish(row: Row, state: State, errorCode: string | null = null) {
    this.operations.finish(row,state,errorCode,this.now());
  }
  private async read(session: SessionRecord, plan: WritebackPlan, row?: Row) {
    for (let attempt = 0; ; attempt++) {
      if (row) this.finish(row,"IN_FLIGHT");
      try {
        const fresh = await this.planner.read(session,plan);
        if (row) this.operations.assertOwned(row,this.now());
        return fresh;
      }
      catch (error) {
        if (row) this.operations.assertOwned(row,this.now());
        if (!retryable(error) || attempt >= 1) throw error;
        await this.sleep(500 * 2 ** attempt + Math.floor(Math.random()*200));
      }
    }
  }
  async preview(session: SessionRecord, activityId: string) {
    assertTeacher(session,this.now());const plan = this.planner.build(session,activityId);
    const existing = this.row(activityId);
    if (existing || !plan.targets.length) return this.view(plan,existing);
    writebackBatch(plan); // Reject oversized or invalid batches before any update.
    const fresh = await this.read(session,plan);
    this.assertOriginal(plan,fresh);
    const row = this.database.transaction(() => {
      if (this.planner.build(session,activityId).payloadHash !== plan.payloadHash) throw sourceConflict();
      this.database.prepare(`INSERT OR IGNORE INTO google_sheets_writebacks
        (operation_id,activity_id,result_version,payload_hash,targets_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,'PREPARED',?,?)`).run(randomUUID(),activityId,plan.resultVersion,plan.payloadHash,
          JSON.stringify({ plan,before: fresh.snapshot } satisfies Stored),this.now().toISOString(),this.now().toISOString());
      return this.row(activityId)!;
    }).immediate();
    return this.view(plan,row);
  }
  private assertOriginal(plan: WritebackPlan, fresh: CloudRead) {
    if (plan.targets.some((t) => fingerprint(t.originalValue) !== fingerprint(fresh.originalAnswers.find((a) => a.anchor === t.anchor)?.value ?? null))) throw sourceConflict();
  }
  private claim(session: SessionRecord, activityId: string, operationId: string, readOnly = false) {
    return this.database.transaction(() => {
      assertTeacher(session,this.now()); const plan = this.planner.build(session,activityId);
      const row = this.row(activityId);
      if (!row || row.operation_id !== operationId) throw new AppError(409,"WRITEBACK_PREVIEW_REQUIRED","請先重新讀取寫回預覽。");
      if (row.payload_hash !== plan.payloadHash || row.result_version !== plan.resultVersion) throw sourceConflict();
      const stored = JSON.parse(row.targets_json) as Stored;
      if (fingerprint(stored.plan) !== fingerprint(plan)) throw sourceConflict();
      if (stored.singleUpdateAttempted && !readOnly) return { row,stored,previous: row.state,claimed: false };
      const previous = this.stale(row) ? "UNKNOWN" : row.state;
      if (["SUCCEEDED","CONFLICT"].includes(previous) || (row.state === "IN_FLIGHT" && !this.stale(row))) return { row,stored,previous,claimed: false };
      this.operations.claim(row,randomUUID(),this.now());
      return { row,stored,previous,claimed: true };
    }).immediate();
  }
  private persistSuccess(row: Row) {
    try { this.finish(row,"SUCCEEDED"); }
    catch (error) {
      if (error instanceof WritebackOwnershipLost) throw error;
      try { this.finish(row,"UNKNOWN","WRITEBACK_RECORD_UNAVAILABLE"); } catch { /* durable IN_FLIGHT is recovered after lease expiry */ }
      throw new AppError(503,"WRITEBACK_RECORD_UNAVAILABLE","雲端可能已成功，但本機紀錄無法確認；請重新讀取操作並核對，不要直接重送。");
    }
  }
  private async inspect(session: SessionRecord,row: Row,stored: Stored) {
    const fresh = await this.read(session,stored.plan,row);
    const expected = stored.plan.targets.every((t) => fingerprint(fresh.originalAnswers.find((a) => a.anchor === t.anchor)?.value ?? null) === fingerprint({ stringValue: t.answer }));
    if (fingerprint(protectedSnapshot(stored.before,stored.plan)) !== fingerprint(protectedSnapshot(fresh.snapshot,stored.plan))) throw sourceConflict();
    if (expected) { verifyWriteback(stored.plan,stored.before,fresh);return "SUCCEEDED" as const; }
    this.assertOriginal(stored.plan,fresh);
    return "FAILED" as const; // All originals: an explicit subsequent retry is permitted.
  }
  async reconcile(session: SessionRecord,activityId: string,operationId: string) {
    try { return await this.reconcileOwned(session,activityId,operationId); }
    catch (error) {
      if (error instanceof WritebackOwnershipLost) return this.status(session,activityId);
      throw error;
    }
  }
  private async reconcileOwned(session: SessionRecord,activityId: string,operationId: string) {
    const claim = this.claim(session,activityId,operationId,true);
    if (!claim.claimed) return this.view(claim.stored.plan,claim.row);
    const { row,stored } = claim;
    try {
      const state = await this.inspect(session,row,stored);
      if (state === "SUCCEEDED") this.persistSuccess(row);else this.finish(row,"FAILED","WRITEBACK_NOT_APPLIED");
    } catch (error) {
      if (error instanceof AppError && error.code === "WRITEBACK_RECORD_UNAVAILABLE") throw error;
      this.finish(row,error instanceof AppError && error.status === 409 ? "CONFLICT" : "UNKNOWN",safeCode(error));
    }
    return this.view(stored.plan,row);
  }
  async renew(session: SessionRecord,activityId: string,operationId: string) {
    assertTeacher(session,this.now());const plan = this.planner.build(session,activityId);
    const previous = this.row(activityId);
    if (!previous || previous.operation_id !== operationId || previous.state !== "FAILED") throw new AppError(409,"WRITEBACK_RENEW_NOT_ALLOWED","只有核對後確定未寫入的失敗操作可建立新操作。");
    const stored = JSON.parse(previous.targets_json) as Stored;
    if (!stored.singleUpdateAttempted) throw new AppError(409,"WRITEBACK_RENEW_NOT_ALLOWED","此操作請沿用原流程。");
    const fresh = await this.read(session,plan);this.assertOriginal(plan,fresh);
    const row = this.database.transaction(() => {
      const current = this.row(activityId);
      if (!current || fingerprint(current) !== fingerprint(previous)) throw sourceConflict();
      const history = [...(stored.history ?? []),{ operationId: previous.operation_id,state: previous.state,errorCode: previous.error_code,updatedAt: previous.updated_at }];
      const result = this.database.prepare("UPDATE google_sheets_writebacks SET operation_id=?,targets_json=?,state='PREPARED',error_code=NULL,updated_at=? WHERE operation_id=? AND state='FAILED' AND targets_json=?")
        .run(randomUUID(),JSON.stringify({ plan,before: fresh.snapshot,history } satisfies Stored),this.now().toISOString(),operationId,previous.targets_json);
      if (result.changes !== 1) throw sourceConflict();
      return this.row(activityId)!;
    }).immediate();
    return this.view(plan,row);
  }
  async confirm(session: SessionRecord,activityId: string,operationId: string) {
    try { return await this.confirmOwned(session,activityId,operationId); }
    catch (error) {
      if (error instanceof WritebackOwnershipLost) return this.status(session,activityId);
      throw error;
    }
  }
  private async confirmOwned(session: SessionRecord,activityId: string,operationId: string) {
    const claim = this.claim(session,activityId,operationId);
    if (!claim.claimed) return this.view(claim.stored.plan,claim.row);
    const { row,stored } = claim;const plan = stored.plan;
    if (claim.previous === "UNKNOWN") {
      try {
        const state = await this.inspect(session,row,stored);
        if (state === "SUCCEEDED") this.persistSuccess(row);else this.finish(row,"FAILED","WRITEBACK_NOT_APPLIED");
      } catch (error) {
        if (error instanceof AppError && error.code === "WRITEBACK_RECORD_UNAVAILABLE") throw error;
        this.finish(row,error instanceof AppError && error.status === 409 ? "CONFLICT" : "UNKNOWN",safeCode(error));
      }
      return this.view(plan,row);
    }
    const maxAttempts = this.singleUpdate ? 1 : 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let before: CloudRead;
      try {
        before = await this.read(session,plan,row);this.assertOriginal(plan,before);
        stored.before = before.snapshot;
      } catch (error) {
        this.finish(row,error instanceof AppError && error.status === 409 ? "CONFLICT" : "FAILED",safeCode(error));
        return this.view(plan,row);
      }
      // No await between persistent CAS admission and entering the Writer.
      this.operations.admitWrite(row,before.snapshot,this.singleUpdate,this.now());
      let writeError: unknown;
      try { await this.writer.write(session,plan,() => this.operations.assertOwned(row,this.now())); }
      catch (error) { writeError = error; }
      if (writeError && knownRejection(writeError)) {
        if (retryable(writeError) && attempt < maxAttempts - 1) {
          await this.sleep(1000 * 2 ** attempt + Math.floor(Math.random()*200));continue;
        }
        this.finish(row,"FAILED",safeCode(writeError));return this.view(plan,row);
      }
      try {
        const state = await this.inspect(session,row,stored);
        if (state === "SUCCEEDED") { this.persistSuccess(row);return this.view(plan,row); }
        if (writeError && retryable(writeError) && attempt < maxAttempts - 1 && (writeError as AppError).code !== "GOOGLE_CONNECTION_FAILED") {
          await this.sleep(1000 * 2 ** attempt + Math.floor(Math.random()*200));continue;
        }
        this.finish(row,"FAILED",writeError ? safeCode(writeError) : "WRITEBACK_NOT_APPLIED");
      } catch (error) {
        if (error instanceof AppError && error.code === "WRITEBACK_RECORD_UNAVAILABLE") throw error;
        this.finish(row,error instanceof AppError && error.status === 409 ? "CONFLICT" : "UNKNOWN",safeCode(error));
      }
      return this.view(plan,row);
    }
    return this.view(plan,row);
  }
}
