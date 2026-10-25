import type Database from "better-sqlite3";
import { rethrowRepositoryError } from "./errors.js";

export interface ExportRecord {
  id: string;
  activityId: string;
  outputPath: string;
  sha256: string;
  createdAt: string;
}

interface ExportRow {
  id: string;
  activity_id: string;
  output_path: string;
  sha256: string;
  created_at: string;
}

function toRecord(row: ExportRow): ExportRecord {
  return { id: row.id, activityId: row.activity_id, outputPath: row.output_path, sha256: row.sha256, createdAt: row.created_at };
}

export class ExportRecordRepository {
  constructor(private readonly database: Database.Database) {}

  create(record: ExportRecord): ExportRecord {
    try {
      this.database.prepare(
        `INSERT INTO export_records (id, activity_id, output_path, sha256, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(record.id, record.activityId, record.outputPath, record.sha256, record.createdAt);
      return record;
    } catch (error) {
      rethrowRepositoryError(error, "匯出紀錄");
    }
  }

  listByActivity(activityId: string): ExportRecord[] {
    return (this.database.prepare(
      "SELECT * FROM export_records WHERE activity_id = ? ORDER BY created_at, id",
    ).all(activityId) as ExportRow[]).map(toRecord);
  }
}
