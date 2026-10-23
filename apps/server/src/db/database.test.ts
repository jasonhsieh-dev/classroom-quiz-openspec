import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

const databases: TestDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.cleanup();
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
        "schema_migrations",
      ]),
    );
    expect(
      database.prepare("SELECT filename FROM schema_migrations").all(),
    ).toEqual([{ filename: "001_initial.sql" }]);
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
