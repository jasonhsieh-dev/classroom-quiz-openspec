import type Database from "better-sqlite3";
import { entityNotFound, rethrowRepositoryError } from "./errors.js";

export interface ImportDraftRecord {
  id: string;
  originalFilename: string;
  tempFilePath: string;
  sourceSha256: string;
  mappingJson: string;
  createdAt: string;
  expiresAt: string;
}

interface ImportDraftRow {
  id: string;
  original_filename: string;
  temp_file_path: string;
  source_sha256: string;
  mapping_json: string;
  created_at: string;
  expires_at: string;
}

function toRecord(row: ImportDraftRow): ImportDraftRecord {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    tempFilePath: row.temp_file_path,
    sourceSha256: row.source_sha256,
    mappingJson: row.mapping_json,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class ImportDraftRepository {
  constructor(private readonly database: Database.Database) {}

  create(record: ImportDraftRecord): ImportDraftRecord {
    try {
      this.database
        .prepare(
          `INSERT INTO import_drafts (
            id, original_filename, temp_file_path, source_sha256,
            mapping_json, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.originalFilename,
          record.tempFilePath,
          record.sourceSha256,
          record.mappingJson,
          record.createdAt,
          record.expiresAt,
        );
      return this.getById(record.id);
    } catch (error) {
      rethrowRepositoryError(error, "匯入草稿");
    }
  }

  findById(id: string): ImportDraftRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM import_drafts WHERE id = ?")
      .get(id) as ImportDraftRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  getById(id: string): ImportDraftRecord {
    const draft = this.findById(id);
    if (!draft) throw entityNotFound("匯入草稿", id);
    return draft;
  }

  listExpired(expiresAtOrBefore: string): ImportDraftRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM import_drafts WHERE expires_at <= ? ORDER BY expires_at, id",
        )
        .all(expiresAtOrBefore) as ImportDraftRow[]
    ).map(toRecord);
  }

  delete(id: string): boolean {
    return this.database.prepare("DELETE FROM import_drafts WHERE id = ?").run(id)
      .changes > 0;
  }
}
