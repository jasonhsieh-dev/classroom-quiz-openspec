import type Database from "better-sqlite3";
import { rethrowRepositoryError } from "./errors.js";

export interface SubmissionAttemptRecord {
  id: number;
  activityId: string;
  questionId: string;
  groupId: string;
  sessionId: string;
  answer: string;
  serverReceivedAt: string;
  receiveSequence: number;
  idempotencyKey: string;
}

interface SubmissionAttemptRow {
  id: number;
  activity_id: string;
  question_id: string;
  group_id: string;
  session_id: string;
  answer: string;
  server_received_at: string;
  receive_sequence: number;
  idempotency_key: string;
}

export interface CreateSubmissionAttemptInput {
  activityId: string;
  questionId: string;
  groupId: string;
  sessionId: string;
  answer: string;
  serverReceivedAt: string;
  receiveSequence: number;
  idempotencyKey: string;
}

function toRecord(row: SubmissionAttemptRow): SubmissionAttemptRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    questionId: row.question_id,
    groupId: row.group_id,
    sessionId: row.session_id,
    answer: row.answer,
    serverReceivedAt: row.server_received_at,
    receiveSequence: row.receive_sequence,
    idempotencyKey: row.idempotency_key,
  };
}

export class SubmissionRepository {
  constructor(private readonly database: Database.Database) {}

  findByIdempotency(
    sessionId: string,
    questionId: string,
    idempotencyKey: string,
  ): SubmissionAttemptRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM submission_attempts
       WHERE session_id = ? AND question_id = ? AND idempotency_key = ?`,
    ).get(sessionId, questionId, idempotencyKey) as SubmissionAttemptRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  createAttempt(input: CreateSubmissionAttemptInput): SubmissionAttemptRecord {
    try {
      const result = this.database.prepare(
        `INSERT INTO submission_attempts (
          activity_id, question_id, group_id, session_id, answer,
          server_received_at, receive_sequence, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.activityId,
        input.questionId,
        input.groupId,
        input.sessionId,
        input.answer,
        input.serverReceivedAt,
        input.receiveSequence,
        input.idempotencyKey,
      );
      return this.getAttempt(Number(result.lastInsertRowid));
    } catch (error) {
      rethrowRepositoryError(error, "提交歷程");
    }
  }

  getAttempt(id: number): SubmissionAttemptRecord {
    const row = this.database.prepare("SELECT * FROM submission_attempts WHERE id = ?").get(id) as SubmissionAttemptRow | undefined;
    if (!row) throw new Error(`找不到提交歷程（${id}）。`);
    return toRecord(row);
  }

  setCurrent(attempt: SubmissionAttemptRecord): void {
    try {
      this.database.prepare(
        `INSERT INTO current_submissions (activity_id, question_id, group_id, attempt_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(question_id, group_id)
         DO UPDATE SET activity_id = excluded.activity_id, attempt_id = excluded.attempt_id`,
      ).run(attempt.activityId, attempt.questionId, attempt.groupId, attempt.id);
    } catch (error) {
      rethrowRepositoryError(error, "目前有效提交");
    }
  }

  listAttemptsByActivity(activityId: string): SubmissionAttemptRecord[] {
    return (this.database.prepare(
      "SELECT * FROM submission_attempts WHERE activity_id = ? ORDER BY receive_sequence",
    ).all(activityId) as SubmissionAttemptRow[]).map(toRecord);
  }

  findCurrent(questionId: string, groupId: string): SubmissionAttemptRecord | undefined {
    const row = this.database.prepare(
      `SELECT a.* FROM current_submissions c
       JOIN submission_attempts a ON a.id = c.attempt_id
       WHERE c.question_id = ? AND c.group_id = ?`,
    ).get(questionId, groupId) as SubmissionAttemptRow | undefined;
    return row ? toRecord(row) : undefined;
  }
}
