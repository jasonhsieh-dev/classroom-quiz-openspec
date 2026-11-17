import type Database from "better-sqlite3";

export interface GoogleSheetsSourceInput {
  activityId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  structureFingerprint: string;
  snapshot: unknown;
  mapping: unknown;
  originalAnswers: unknown;
  createdAt: string;
}

/** Internal persistence boundary; cloud snapshots never enter student DTOs. */
export class GoogleSheetsSourceRepository {
  constructor(private readonly database: Database.Database) {}

  createActivity(input: GoogleSheetsSourceInput & { title: string }): void {
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO activities
        (id, title, source_kind, created_at) VALUES (?, ?, 'google-sheets', ?)`)
        .run(input.activityId, input.title, input.createdAt);
      this.database.prepare(`INSERT INTO google_sheets_sources
        (activity_id, spreadsheet_id, sheet_id, sheet_title, structure_fingerprint,
         snapshot_json, mapping_json, original_answers_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.activityId, input.spreadsheetId, input.sheetId, input.sheetTitle,
          input.structureFingerprint, JSON.stringify(input.snapshot), JSON.stringify(input.mapping),
          JSON.stringify(input.originalAnswers), input.createdAt);
    })();
  }

  findByActivity(activityId: string): GoogleSheetsSourceInput | undefined {
    const row = this.database.prepare("SELECT * FROM google_sheets_sources WHERE activity_id = ?")
      .get(activityId) as { activity_id: string; spreadsheet_id: string; sheet_id: number;
        sheet_title: string; structure_fingerprint: string; snapshot_json: string;
        mapping_json: string; original_answers_json: string; created_at: string } | undefined;
    if (!row) return undefined;
    return { activityId: row.activity_id, spreadsheetId: row.spreadsheet_id, sheetId: row.sheet_id,
      sheetTitle: row.sheet_title, structureFingerprint: row.structure_fingerprint,
      snapshot: JSON.parse(row.snapshot_json), mapping: JSON.parse(row.mapping_json),
      originalAnswers: JSON.parse(row.original_answers_json), createdAt: row.created_at };
  }
}
