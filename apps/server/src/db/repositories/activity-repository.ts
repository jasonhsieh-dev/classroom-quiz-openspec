import type { ActivityState } from "@classroom-buzzer/shared";
import type Database from "better-sqlite3";
import {
  entityNotFound,
  rethrowRepositoryError,
} from "./errors.js";

export interface ActivityRecord {
  id: string;
  title: string;
  state: ActivityState;
  revision: number;
  nextReceiveSequence: number;
  sourceKind: "legacy-xlsx" | "google-sheets";
  sourceFilePath: string | null;
  sourceSha256: string | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  title: string;
  state: ActivityState;
  revision: number;
  next_receive_sequence: number;
  source_kind: "legacy-xlsx" | "google-sheets";
  source_file_path: string | null;
  source_sha256: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface ActivitySummaryRecord {
  activityId: string;
  title: string;
  state: ActivityState;
  revision: number;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
  questionCount: number;
}

interface ActivitySummaryRow {
  activity_id: string;
  title: string;
  state: ActivityState;
  revision: number;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
  question_count: number;
}

export interface CreateActivityInput {
  id: string;
  title: string;
  sourceFilePath: string;
  sourceSha256: string;
  createdAt: string;
}

function toActivityRecord(row: ActivityRow): ActivityRecord {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    revision: row.revision,
    nextReceiveSequence: row.next_receive_sequence,
    sourceKind: row.source_kind,
    sourceFilePath: row.source_file_path,
    sourceSha256: row.source_sha256,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

export class ActivityRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: CreateActivityInput): ActivityRecord {
    try {
      this.database
        .prepare(
          `INSERT INTO activities (
            id, title, source_file_path, source_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.title,
          input.sourceFilePath,
          input.sourceSha256,
          input.createdAt,
        );
      return this.getById(input.id);
    } catch (error) {
      rethrowRepositoryError(error, "活動");
    }
  }

  findById(id: string): ActivityRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(id) as ActivityRow | undefined;
    return row ? toActivityRecord(row) : undefined;
  }

  getById(id: string): ActivityRecord {
    const activity = this.findById(id);
    if (!activity) throw entityNotFound("活動", id);
    return activity;
  }

  list(): ActivityRecord[] {
    return (
      this.database
        .prepare("SELECT * FROM activities ORDER BY created_at, id")
        .all() as ActivityRow[]
    ).map(toActivityRecord);
  }

  listSummaries(): ActivitySummaryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT
           activities.id AS activity_id,
           activities.title,
           activities.state,
           activities.revision,
           activities.created_at,
           activities.opened_at,
           activities.closed_at,
           COUNT(questions.id) AS question_count
         FROM activities
         LEFT JOIN questions ON questions.activity_id = activities.id
         GROUP BY activities.id
         ORDER BY activities.created_at DESC, activities.id DESC`,
      )
      .all() as ActivitySummaryRow[];
    return rows.map((row) => ({
      activityId: row.activity_id,
      title: row.title,
      state: row.state,
      revision: row.revision,
      createdAt: row.created_at,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      questionCount: row.question_count,
    }));
  }

  rename(id: string, title: string): ActivityRecord {
    try {
      const result = this.database
        .prepare("UPDATE activities SET title = ? WHERE id = ?")
        .run(title, id);
      if (result.changes === 0) throw entityNotFound("活動", id);
      return this.getById(id);
    } catch (error) {
      rethrowRepositoryError(error, "活動");
    }
  }
}
