import type Database from "better-sqlite3";
import type { SessionRecord } from "../db/repositories/session-repository.js";
import { ActivityRepository, QuestionRepository } from "../db/repositories/index.js";
import { GoogleSheetsSourceRepository } from "../db/repositories/google-sheets-source-repository.js";
import { ResultService } from "../services/result-service.js";
import { AppError } from "../errors.js";
import { fingerprint, type GoogleSheetsReader, type EnteredValue } from "./google-sheets-reader.js";
import { GuidedNotesError } from "./errors.js";
import type { GuidedNotesQuestionMapping } from "./parser.js";
export type CloudRead = Awaited<ReturnType<GoogleSheetsReader["read"]>>;
export interface WritebackTarget { questionId: string; displayNumber: string; anchor: string; answer: string; originalValue: EnteredValue | null }
export interface WritebackPlan { activityId: string; resultVersion: number; spreadsheetId: string; sheetId: number; sheetTitle: string;
  structureFingerprint: string; targets: WritebackTarget[]; payloadHash: string }
export function assertTeacher(session: SessionRecord, now = new Date()) {
  if (session.role !== "teacher" || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now.getTime()) throw new AppError(403,"ROLE_FORBIDDEN","需要有效老師 Session。");
}
export function sourceConflict(): AppError { return new AppError(409,"GOOGLE_SOURCE_CHANGED","雲端結構、題目或目標原值已變更，已停止寫回；請檢查原文件，不要直接重試覆蓋。"); }
export class GoogleSheetsWritebackPlanner {
  constructor(private readonly database: Database.Database, private readonly reader: GoogleSheetsReader) {}
  build(session: SessionRecord, activityId: string): WritebackPlan {
    assertTeacher(session);
    const activity = new ActivityRepository(this.database).getById(activityId);
    if (activity.state !== "CLOSED") throw new AppError(409,"ACTIVITY_NOT_CLOSED","只有已結束活動可以寫回 Google Sheets。");
    const source = new GoogleSheetsSourceRepository(this.database).findByActivity(activityId);
    if (activity.sourceKind !== "google-sheets" || !source) throw new AppError(409,"SOURCE_TYPE_UNSUPPORTED","此活動不是 Google Sheets 來源，請使用歷史下載。");
    const saved = source.mapping as GuidedNotesQuestionMapping[];
    const originals = source.originalAnswers as { anchor: string; value: EnteredValue | null }[];
    const questions = new QuestionRepository(this.database).listByActivity(activityId);
    const results = new ResultService(this.database).teacher(activityId);
    if (questions.length !== saved.length || questions.some((q,i) => q.displayNumber !== saved[i]?.displayNumber || q.answerAnchor !== saved[i]?.answerAnchor || q.answerRange !== saved[i]?.answerRange || q.numberCell !== saved[i]?.numberCell || q.promptRange !== saved[i]?.promptRange)) throw sourceConflict();
    const targets = results.questions.flatMap((result) => {
      const winner = result.rankings.find((r) => r.rank === 1);
      if (!winner) return [];
      const question = questions.find((q) => q.id === result.question.id)!;
      const original = originals.find((a) => a.anchor === question.answerAnchor);
      if (!original) throw sourceConflict();
      return [{ questionId: question.id, displayNumber: question.displayNumber, anchor: question.answerAnchor,answer: winner.answer,originalValue: original.value }];
    });
    const plan = { activityId,resultVersion: activity.revision,spreadsheetId: source.spreadsheetId,sheetId: source.sheetId,sheetTitle: source.sheetTitle,structureFingerprint: source.structureFingerprint,targets };
    return { ...plan,payloadHash: fingerprint(plan) };
  }
  async read(session: SessionRecord, plan: WritebackPlan): Promise<CloudRead> {
    let fresh: CloudRead;
    try { fresh = await this.reader.read(session,`https://docs.google.com/spreadsheets/d/${plan.spreadsheetId}/edit`,plan.sheetId); }
    catch (error) {
      if (error instanceof GuidedNotesError || (error instanceof AppError && ["GOOGLE_GRID_INVALID","GOOGLE_SHEET_NOT_FOUND"].includes(error.code))) throw sourceConflict();
      throw error;
    }
    if (fresh.spreadsheetId !== plan.spreadsheetId || fresh.sheetId !== plan.sheetId || fresh.structureFingerprint !== plan.structureFingerprint) throw sourceConflict();
    return fresh;
  }
  async preflight(session: SessionRecord, plan: WritebackPlan): Promise<CloudRead> {
    const fresh = await this.read(session,plan);
    if (plan.targets.some((t) => fingerprint(fresh.originalAnswers.find((a) => a.anchor === t.anchor)?.value ?? null) !== fingerprint(t.originalValue))) throw sourceConflict();
    return fresh;
  }
}
