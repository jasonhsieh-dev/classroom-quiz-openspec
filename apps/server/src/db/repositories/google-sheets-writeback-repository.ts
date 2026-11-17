import type Database from "better-sqlite3";

export type WritebackState = "PREPARED" | "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CONFLICT";
export interface WritebackRow {
  operation_id: string; activity_id: string; result_version: number; payload_hash: string;
  targets_json: string; state: WritebackState; error_code: string | null; updated_at: string;
}
export const writebackLeaseMs = 120_000;
export class WritebackOwnershipLost extends Error {}

/** Persistent fencing and write admission. No network work belongs in this repository. */
export class GoogleSheetsWritebackRepository {
  constructor(private readonly database: Database.Database) {}
  find(activityId: string): WritebackRow | undefined {
    return this.database.prepare("SELECT * FROM google_sheets_writebacks WHERE activity_id=?").get(activityId) as WritebackRow | undefined;
  }
  private cutoff(now: Date) { return new Date(now.getTime() - writebackLeaseMs).toISOString(); }
  private token(row: WritebackRow): string { return (JSON.parse(row.targets_json) as { ownershipToken: string }).ownershipToken; }
  claim(row: WritebackRow, token: string, now: Date): void {
    const result = this.database.prepare(`UPDATE google_sheets_writebacks
      SET targets_json=json_set(targets_json,'$.ownershipToken',?),state='IN_FLIGHT',error_code=NULL,updated_at=?
      WHERE operation_id=? AND targets_json=? AND state=? AND (state!='IN_FLIGHT' OR updated_at<=?)`)
      .run(token,now.toISOString(),row.operation_id,row.targets_json,row.state,this.cutoff(now));
    if (result.changes !== 1) throw new WritebackOwnershipLost();
    Object.assign(row,this.find(row.activity_id));
  }
  assertOwned(row: WritebackRow, now: Date): void {
    const owned = this.database.prepare(`SELECT 1 FROM google_sheets_writebacks
      WHERE operation_id=? AND state='IN_FLIGHT' AND json_extract(targets_json,'$.ownershipToken')=? AND updated_at>?`)
      .get(row.operation_id,this.token(row),this.cutoff(now));
    if (!owned) throw new WritebackOwnershipLost();
  }
  finish(row: WritebackRow, state: WritebackState, errorCode: string | null, now: Date): void {
    const result = this.database.prepare(`UPDATE google_sheets_writebacks SET state=?,error_code=?,updated_at=?
      WHERE operation_id=? AND state='IN_FLIGHT' AND json_extract(targets_json,'$.ownershipToken')=? AND updated_at>?`)
      .run(state,errorCode,now.toISOString(),row.operation_id,this.token(row),this.cutoff(now));
    if (result.changes !== 1) throw new WritebackOwnershipLost();
    row.state = state;row.error_code = errorCode;row.updated_at = now.toISOString();
  }
  admitWrite(row: WritebackRow, before: unknown, singleUpdate: boolean, now: Date): void {
    // Patch current JSON, never replace it with an object captured before an await.
    // An existing single-update grant is irreversible for this operation, even in normal mode.
    const marker = singleUpdate ? ", '$.singleUpdateAttempted', json('true')" : "";
    const result = this.database.prepare(`UPDATE google_sheets_writebacks
      SET targets_json=json_set(targets_json,'$.before',json(?)${marker}),updated_at=?
      WHERE operation_id=? AND state='IN_FLIGHT' AND json_extract(targets_json,'$.ownershipToken')=?
        AND updated_at>? AND COALESCE(json_extract(targets_json,'$.singleUpdateAttempted'),0)=0`)
      .run(JSON.stringify(before),now.toISOString(),row.operation_id,this.token(row),this.cutoff(now));
    if (result.changes !== 1) throw new WritebackOwnershipLost();
    Object.assign(row,this.find(row.activity_id));
  }
}
