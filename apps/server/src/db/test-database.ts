import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { initializeDatabase } from "./database.js";

export interface TestDatabase {
  database: Database.Database;
  directory: string;
  filename: string;
  cleanup: () => void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "classroom-buzzer-test-"));
  const filename = join(directory, "test.sqlite");
  const database = initializeDatabase(filename);
  let cleaned = false;

  return {
    database,
    directory,
    filename,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      database.close();

      const resolvedDirectory = resolve(directory);
      const resolvedTemporaryRoot = resolve(tmpdir());
      const relativeDirectory = relative(resolvedTemporaryRoot, resolvedDirectory);
      if (
        relativeDirectory.startsWith("..") ||
        isAbsolute(relativeDirectory) ||
        !basename(resolvedDirectory).startsWith("classroom-buzzer-test-")
      ) {
        throw new Error("拒絕清理非測試暫存目錄");
      }
      rmSync(resolvedDirectory, { recursive: true, force: true });
    },
  };
}
