import type Database from "better-sqlite3";
import { rethrowRepositoryError } from "./errors.js";

export interface ResultEntryRecord {
  activityId: string;
  questionId: string;
  groupId: string;
  attemptId: number;
  rank: number;
}

interface ResultEntryRow {
  activity_id: string;
  question_id: string;
  group_id: string;
  attempt_id: number;
  rank: number;
}

function toRecord(row: ResultEntryRow): ResultEntryRecord {
  return {
    activityId: row.activity_id,
    questionId: row.question_id,
    groupId: row.group_id,
    attemptId: row.attempt_id,
    rank: row.rank,
  };
}

export class ResultRepository {
  constructor(private readonly database: Database.Database) {}

  createFromCurrentSubmissions(activityId: string): number {
    try {
      const result = this.database.prepare(
        `INSERT INTO result_entries (
          activity_id, question_id, group_id, attempt_id, rank
        )
        SELECT
          current.activity_id,
          current.question_id,
          current.group_id,
          current.attempt_id,
          ROW_NUMBER() OVER (
            PARTITION BY current.question_id
            ORDER BY attempt.receive_sequence ASC
          )
        FROM current_submissions AS current
        JOIN submission_attempts AS attempt
          ON attempt.id = current.attempt_id
         AND attempt.activity_id = current.activity_id
         AND attempt.question_id = current.question_id
         AND attempt.group_id = current.group_id
        WHERE current.activity_id = ?`,
      ).run(activityId);
      return result.changes;
    } catch (error) {
      rethrowRepositoryError(error, "活動結果");
    }
  }

  listByActivity(activityId: string): ResultEntryRecord[] {
    return (this.database.prepare(
      `SELECT activity_id, question_id, group_id, attempt_id, rank
       FROM result_entries
       WHERE activity_id = ?
       ORDER BY question_id, rank`,
    ).all(activityId) as ResultEntryRow[]).map(toRecord);
  }
}
