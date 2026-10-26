import Database from "better-sqlite3";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "./database.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

const databases: TestDatabase[] = [];
const legacyDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.cleanup();
  }
  for (const directory of legacyDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabase(): TestDatabase {
  const database = createTestDatabase();
  databases.push(database);
  return database;
}

function insertActivity(database: TestDatabase["database"], id = "activity-1") {
  database
    .prepare(
      `INSERT INTO activities (
        id, title, source_file_path, source_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, "測試活動", "source.xlsx", "synthetic-sha256", new Date().toISOString());
}

describe("SQLite 初始化與 migrations", () => {
  it("由舊 schema 升級時將既有老師 session 轉成全域 scope 並保留學生綁定", () => {
    const directory = mkdtempSync(join(tmpdir(), "classroom-buzzer-legacy-"));
    legacyDirectories.push(directory);
    const filename = join(directory, "legacy.sqlite");
    const legacy = new Database(filename);
    legacy.pragma("foreign_keys = ON");
    legacy.exec(readFileSync(new URL("./migrations/001_initial.sql", import.meta.url), "utf8"));
    legacy.exec(readFileSync(new URL("./migrations/002_import_drafts.sql", import.meta.url), "utf8"));
    legacy.exec(`
      CREATE TABLE schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES
        ('001_initial.sql', '2026-10-23T00:00:00.000Z'),
        ('002_import_drafts.sql', '2026-10-23T00:01:00.000Z');
    `);
    const now = "2026-10-23T01:00:00.000Z";
    insertActivity(legacy, "activity-1");
    legacy
      .prepare(
        "INSERT INTO groups (id, activity_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("group-1", "activity-1", "第一組", "第一組", now);
    const insertLegacySession = legacy.prepare(
      "INSERT INTO sessions (id, role, activity_id, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insertLegacySession.run(
      "teacher-session",
      "teacher",
      "activity-1",
      null,
      now,
      "2026-10-23T09:00:00.000Z",
    );
    insertLegacySession.run(
      "student-session",
      "student",
      "activity-1",
      "group-1",
      now,
      "2026-10-23T09:00:00.000Z",
    );
    legacy.close();

    const migrated = initializeDatabase(filename);
    expect(
      migrated
        .prepare(
          "SELECT id, role, activity_id, group_id FROM sessions ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "student-session",
        role: "student",
        activity_id: "activity-1",
        group_id: "group-1",
      },
      {
        id: "teacher-session",
        role: "teacher",
        activity_id: null,
        group_id: null,
      },
    ]);
    migrated.close();
  });

  it("建立完整 schema 並記錄 migration", () => {
    const { database } = createDatabase();
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "activities",
        "groups",
        "sessions",
        "questions",
        "submission_attempts",
        "current_submissions",
        "result_entries",
        "export_records",
        "import_drafts",
        "schema_migrations",
      ]),
    );
    expect(
      database.prepare("SELECT filename FROM schema_migrations").all(),
    ).toEqual([
      { filename: "001_initial.sql" },
      { filename: "002_import_drafts.sql" },
      { filename: "003_global_teacher_sessions.sql" },
      { filename: "004_question_prompts.sql" },
    ]);
  });

  it("由既有 schema 新增 nullable 題目欄位且完整保留活動關聯資料", () => {
    const directory = mkdtempSync(join(tmpdir(), "classroom-buzzer-prompts-"));
    legacyDirectories.push(directory);
    const filename = join(directory, "legacy.sqlite");
    const legacy = new Database(filename);
    legacy.pragma("foreign_keys = ON");
    for (const migration of [
      "001_initial.sql",
      "002_import_drafts.sql",
      "003_global_teacher_sessions.sql",
    ]) {
      legacy.exec(
        readFileSync(new URL(`./migrations/${migration}`, import.meta.url), "utf8"),
      );
    }
    legacy.exec(`
      CREATE TABLE schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES
        ('001_initial.sql', '2026-10-23T00:00:00.000Z'),
        ('002_import_drafts.sql', '2026-10-23T00:01:00.000Z'),
        ('003_global_teacher_sessions.sql', '2026-10-23T00:02:00.000Z');
    `);
    const now = "2026-10-23T01:00:00.000Z";
    legacy.prepare(
      `INSERT INTO activities (
        id, title, state, revision, source_file_path, source_sha256,
        opened_at, closed_at, created_at
      ) VALUES (?, ?, 'CLOSED', 2, ?, ?, ?, ?, ?)`,
    ).run("activity-1", "既有活動", "source.xlsx", "sha256", now, now, now);
    legacy.prepare(
      "INSERT INTO groups (id, activity_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("group-1", "activity-1", "第一組", "第一組", now);
    legacy.prepare(
      `INSERT INTO questions (
        id, activity_id, display_number, sort_order, sheet_name,
        number_cell, answer_range, answer_anchor, original_answer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("question-1", "activity-1", "1", 0, "學習單", "A2", "C2:D2", "C2", "原答案");
    legacy.prepare(
      "INSERT INTO sessions (id, role, activity_id, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("student-session", "student", "activity-1", "group-1", now, "2026-10-24T01:00:00.000Z");
    const attempt = legacy.prepare(
      `INSERT INTO submission_attempts (
        activity_id, question_id, group_id, session_id, answer,
        server_received_at, receive_sequence, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("activity-1", "question-1", "group-1", "student-session", "作答", now, 1, "key-1");
    legacy.prepare(
      "INSERT INTO current_submissions (activity_id, question_id, group_id, attempt_id) VALUES (?, ?, ?, ?)",
    ).run("activity-1", "question-1", "group-1", attempt.lastInsertRowid);
    legacy.prepare(
      "INSERT INTO result_entries (activity_id, question_id, group_id, attempt_id, rank) VALUES (?, ?, ?, ?, ?)",
    ).run("activity-1", "question-1", "group-1", attempt.lastInsertRowid, 1);
    legacy.close();

    const migrated = initializeDatabase(filename);
    const columns = migrated
      .prepare("PRAGMA table_info(questions)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["prompt_text", "prompt_range"]));
    expect(migrated.prepare(
      `SELECT id, activity_id, display_number, sheet_name, number_cell,
              answer_range, answer_anchor, original_answer, prompt_text, prompt_range
       FROM questions`,
    ).get()).toEqual({
      id: "question-1", activity_id: "activity-1", display_number: "1",
      sheet_name: "學習單", number_cell: "A2", answer_range: "C2:D2",
      answer_anchor: "C2", original_answer: "原答案",
      prompt_text: null, prompt_range: null,
    });
    for (const table of [
      "activities", "groups", "sessions", "submission_attempts",
      "current_submissions", "result_entries",
    ]) {
      expect((migrated.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(1);
    }
    migrated.close();
  });

  it("啟用 foreign keys、WAL 與 busy timeout", () => {
    const { database } = createDatabase();
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000);
  });

  it("強制 foreign key 與組別唯一限制", () => {
    const { database } = createDatabase();
    insertActivity(database);
    const insertGroup = database.prepare(
      `INSERT INTO groups (
        id, activity_id, name, normalized_name, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    );

    insertGroup.run("group-1", "activity-1", "第一組", "第一組", new Date().toISOString());
    expect(() =>
      insertGroup.run("group-2", "activity-1", " 第一組 ", "第一組", new Date().toISOString()),
    ).toThrow();
    expect(() =>
      insertGroup.run("group-3", "missing", "第三組", "第三組", new Date().toISOString()),
    ).toThrow();
  });

  it("強制老師為全域 session，學生同時綁定同活動的 group", () => {
    const { database } = createDatabase();
    insertActivity(database, "activity-1");
    insertActivity(database, "activity-2");
    const now = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO groups (id, activity_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("group-1", "activity-1", "第一組", "第一組", now);
    const insertSession = database.prepare(
      "INSERT INTO sessions (id, role, activity_id, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    expect(() =>
      insertSession.run("teacher", "teacher", null, null, now, now),
    ).not.toThrow();
    expect(() =>
      insertSession.run(
        "scoped-teacher",
        "teacher",
        "activity-1",
        null,
        now,
        now,
      ),
    ).toThrow();
    expect(() =>
      insertSession.run(
        "student-without-group",
        "student",
        "activity-1",
        null,
        now,
        now,
      ),
    ).toThrow();
    expect(() =>
      insertSession.run(
        "cross-activity",
        "student",
        "activity-2",
        "group-1",
        now,
        now,
      ),
    ).toThrow();
    expect(() =>
      insertSession.run(
        "student",
        "student",
        "activity-1",
        "group-1",
        now,
        now,
      ),
    ).not.toThrow();
  });

  it("強制接收序號及冪等鍵唯一限制", () => {
    const { database } = createDatabase();
    insertActivity(database);
    const now = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO groups (id, activity_id, name, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("group-1", "activity-1", "第一組", "第一組", now);
    database
      .prepare(
        "INSERT INTO sessions (id, role, activity_id, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("session-1", "student", "activity-1", "group-1", now, now);
    database
      .prepare(
        `INSERT INTO questions (
          id, activity_id, display_number, sort_order, sheet_name,
          number_cell, answer_range, answer_anchor, original_answer
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "question-1",
        "activity-1",
        "1",
        0,
        "學習單",
        "A2",
        "B2",
        "B2",
        null,
      );

    const insertAttempt = database.prepare(
      `INSERT INTO submission_attempts (
        activity_id, question_id, group_id, session_id, answer,
        server_received_at, receive_sequence, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertAttempt.run(
      "activity-1",
      "question-1",
      "group-1",
      "session-1",
      "答案一",
      now,
      1,
      "key-1",
    );

    expect(() =>
      insertAttempt.run(
        "activity-1",
        "question-1",
        "group-1",
        "session-1",
        "答案二",
        now,
        1,
        "key-2",
      ),
    ).toThrow();
    expect(() =>
      insertAttempt.run(
        "activity-1",
        "question-1",
        "group-1",
        "session-1",
        "答案三",
        now,
        2,
        "key-1",
      ),
    ).toThrow();
  });

  it("每個測試資料庫使用獨立暫存目錄並可完整清理", () => {
    const first = createDatabase();
    const second = createDatabase();
    expect(first.directory).not.toBe(second.directory);
    expect(existsSync(first.filename)).toBe(true);
    expect(existsSync(second.filename)).toBe(true);

    first.cleanup();
    databases.splice(databases.indexOf(first), 1);
    expect(existsSync(first.directory)).toBe(false);
    expect(existsSync(second.directory)).toBe(true);
  });
});
