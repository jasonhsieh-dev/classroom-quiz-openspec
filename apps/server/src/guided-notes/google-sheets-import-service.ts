import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SessionRecord } from "../db/repositories/session-repository.js";
import { ActivityRepository } from "../db/repositories/activity-repository.js";
import { QuestionRepository } from "../db/repositories/question-repository.js";
import { GoogleSheetsSourceRepository } from "../db/repositories/google-sheets-source-repository.js";
import { AppError } from "../errors.js";
import { fingerprint, GoogleSheetsReader } from "./google-sheets-reader.js";
import type { GuidedNotesQuestionMapping } from "./parser.js";

type ReadResult = Awaited<ReturnType<GoogleSheetsReader["read"]>>;
interface DraftRow { id: string; spreadsheet_id: string; sheet_id: number; sheet_title: string;
  structure_fingerprint: string; snapshot_json: string; mapping_json: string;
  original_answers_json: string; created_at: string; expires_at: string }
/** Backend workflow only; HTTP routes and UI are deliberately left to Phase 3. */
export class GoogleSheetsImportService {
  constructor(private readonly database: Database.Database,
    private readonly reader = new GoogleSheetsReader(),
    private readonly now = () => new Date(),
    private readonly idFactory: () => string = randomUUID) {}

  questionCount(activityId: string): number { return new QuestionRepository(this.database).listByActivity(activityId).length; }

  private authorize(session: SessionRecord) {
    if (session.role !== "teacher" || session.expiresAt <= this.now().toISOString()) throw new AppError(403, "ROLE_FORBIDDEN", "需要有效老師 Session。");
  }
  async createDraft(session: SessionRecord, url: string, sheetId: number) {
    this.authorize(session);
    const result = await this.reader.read(session,url,sheetId);
    const createdAt = this.now().toISOString(), expiresAt = new Date(this.now().getTime() + 30 * 60_000).toISOString();
    const id = this.idFactory();
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM google_sheets_import_drafts WHERE expires_at <= ?").run(createdAt);
      this.database.prepare(`INSERT INTO google_sheets_import_drafts
        (id,spreadsheet_id,sheet_id,sheet_title,structure_fingerprint,snapshot_json,mapping_json,original_answers_json,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id,result.spreadsheetId,result.sheetId,result.sheetTitle,
          result.structureFingerprint,JSON.stringify(result.snapshot),JSON.stringify(result.mappings),JSON.stringify(result.originalAnswers),createdAt,expiresAt);
    })();
    return { importId: id, spreadsheetId: result.spreadsheetId, sheetId, sheetTitle: result.sheetTitle,
      expiresAt, questionCount: result.mappings.length,
      questions: result.mappings.map((mapping,index) => ({ ...mapping, willOverwrite: result.originalAnswers[index]?.value !== null })) };
  }
  cancelDraft(session: SessionRecord, id: string): void {
    this.authorize(session);
    this.database.prepare("DELETE FROM google_sheets_import_drafts WHERE id = ?").run(id);
  }
  private draft(id: string): DraftRow {
    const row = this.database.prepare("SELECT * FROM google_sheets_import_drafts WHERE id = ?").get(id) as DraftRow | undefined;
    if (!row) throw new AppError(404, "IMPORT_DRAFT_NOT_FOUND", "找不到匯入草稿，請重新預覽。");
    if (row.expires_at <= this.now().toISOString()) throw new AppError(410, "IMPORT_DRAFT_EXPIRED", "匯入草稿已過期，請重新預覽。");
    return row;
  }
  async confirmDraft(session: SessionRecord, id: string, title: string) {
    this.authorize(session);
    title = title.trim();
    if (!title || title.length > 200) throw new AppError(400, "INVALID_ACTIVITY_TITLE", "活動名稱須為 1 至 200 字。");
    const draft = this.draft(id);
    // Never hold a SQLite transaction while waiting for Google.
    const fresh = await this.reader.read(session,`https://docs.google.com/spreadsheets/d/${draft.spreadsheet_id}/edit`,draft.sheet_id);
    if (fresh.structureFingerprint !== draft.structure_fingerprint || fingerprint(fresh.originalAnswers) !== fingerprint(JSON.parse(draft.original_answers_json))) {
      throw new AppError(409, "GOOGLE_SOURCE_CHANGED", "雲端來源已變更，請重新預覽，不會建立活動。");
    }
    return this.database.transaction(() => {
      this.authorize(session);
      const current = this.draft(id);
      if (fingerprint(current) !== fingerprint(draft)) throw new AppError(409, "IMPORT_DRAFT_CHANGED", "匯入草稿已變更，請重新預覽。");
      const activityId = this.idFactory();
      const mappings = JSON.parse(draft.mapping_json) as GuidedNotesQuestionMapping[];
      new GoogleSheetsSourceRepository(this.database).createActivity({ activityId,title,
        spreadsheetId: draft.spreadsheet_id,sheetId: draft.sheet_id,sheetTitle: fresh.sheetTitle,
        structureFingerprint: draft.structure_fingerprint,snapshot: JSON.parse(draft.snapshot_json) as ReadResult["snapshot"],
        mapping: mappings, originalAnswers: JSON.parse(draft.original_answers_json),createdAt: this.now().toISOString() });
      const questions = new QuestionRepository(this.database);
      mappings.forEach((mapping,sortOrder) => { questions.create({ ...mapping, id: this.idFactory(),activityId,sortOrder }); });
      this.database.prepare("DELETE FROM google_sheets_import_drafts WHERE id = ?").run(id);
      return new ActivityRepository(this.database).getById(activityId);
    }).immediate();
  }
}
