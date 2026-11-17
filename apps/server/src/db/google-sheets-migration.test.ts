import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { initializeDatabase } from "./database.js";
import { GoogleSheetsSourceRepository } from "./repositories/google-sheets-source-repository.js";
import { ActivityRepository } from "./repositories/activity-repository.js";

it("升級舊資料保留所有關聯、檔案、外鍵與唯一 OPEN；重啟不重複遷移", () => {
  const directory = mkdtempSync(join(tmpdir(), "classroom-cloud-upgrade-"));
  const filename = join(directory, "legacy.sqlite");
  let db = new Database(filename);
  try {
    const migrations = new URL("./migrations/", import.meta.url);
    db.exec("CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const file of readdirSync(migrations).filter((name) => name < "005" && name.endsWith(".sql")).sort()) {
      db.exec(readFileSync(new URL(file, migrations), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES (?, 'now')").run(file);
    }
    const source = join(directory, "source.xlsx");
    writeFileSync(source, "synthetic-original-file");
    db.prepare(`INSERT INTO activities (id,title,state,revision,next_receive_sequence,source_file_path,source_sha256,created_at)
      VALUES ('a','歷史','CLOSED',2,1,?,'hash','now')`).run(source);
    db.exec(`INSERT INTO groups VALUES ('g','a','組別','組別','now');
      INSERT INTO sessions VALUES ('s','student','a','g','now','later');
      INSERT INTO questions (id,activity_id,display_number,sort_order,sheet_name,number_cell,answer_range,answer_anchor,original_answer,prompt_text,prompt_range)
        VALUES ('q','a','1',0,'Sheet','A2','C2','C2','old','題目','B2');
      INSERT INTO submission_attempts (activity_id,question_id,group_id,session_id,answer,server_received_at,receive_sequence,idempotency_key)
        VALUES ('a','q','g','s','答案','now',1,'key');
      INSERT INTO current_submissions VALUES ('a','q','g',1);
      INSERT INTO result_entries VALUES ('a','q','g',1,1);
      INSERT INTO export_records VALUES ('e','a','out.xlsx','hash','now');`);
    const tables = ["activities", "groups", "sessions", "questions", "submission_attempts", "current_submissions", "result_entries", "export_records"];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    db.close(); db = initializeDatabase(filename);
    for (const [index, table] of tables.entries()) {
      const after = db.prepare(`SELECT * FROM ${table}`).all();
      if (table === "activities") expect(after).toEqual((before[index] as object[]).map((row) => ({ ...row, source_kind: "legacy-xlsx" })));
      else expect(after).toEqual(before[index]);
    }
    expect(readFileSync(source, "utf8")).toBe("synthetic-original-file");
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.prepare("INSERT INTO groups VALUES ('bad','missing','x','x','now')").run()).toThrow();
    db.exec("UPDATE activities SET state='OPEN' WHERE id='a'");
    expect(() => db.exec("INSERT INTO activities (id,title,state,source_file_path,source_sha256,created_at) VALUES ('other','x','OPEN','x','x','now')")).toThrow();
    const repo = new GoogleSheetsSourceRepository(db);
    const input = { activityId: "cloud", title: "雲端", spreadsheetId: "synthetic", sheetId: 0, sheetTitle: "分頁", structureFingerprint: "fp", snapshot: [{ prompt: "題目" }], mapping: [{ anchor: "C2" }], originalAnswers: [null], createdAt: "now" };
    repo.createActivity(input);
    expect(new ActivityRepository(db).getById("cloud")).toMatchObject({ sourceKind: "google-sheets", sourceFilePath: null, sourceSha256: null });
    const { title: _title, ...sourceInput } = input;
    expect(repo.findByActivity("cloud")).toEqual(sourceInput);
    expect(() => db.exec("INSERT INTO activities (id,title,source_kind,source_file_path,created_at) VALUES ('fake','x','google-sheets','fake.xlsx','now')")).toThrow();
    db.prepare(`INSERT INTO google_sheets_writebacks VALUES ('op','cloud',1,'hash','[]','PREPARED',NULL,'now','now')`).run();
    expect(() => db.exec("INSERT INTO google_sheets_writebacks VALUES ('other','cloud',1,'hash','[]','PREPARED',NULL,'now','now')")).toThrow();
    db.close(); db = initializeDatabase(filename);
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 5 });
    expect(new GoogleSheetsSourceRepository(db).findByActivity("cloud")).toEqual(sourceInput);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
