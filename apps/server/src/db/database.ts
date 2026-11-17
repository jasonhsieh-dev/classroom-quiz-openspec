import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const defaultMigrationsDirectory = fileURLToPath(
  new URL("./migrations/", import.meta.url),
);

export interface DatabaseOptions {
  migrationsDirectory?: string;
  busyTimeoutMs?: number;
}

function applyMigrations(
  database: Database.Database,
  migrationsDirectory: string,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = database
    .prepare("SELECT filename FROM schema_migrations")
    .all()
    .map((row) => (row as { filename: string }).filename);
  const appliedSet = new Set(applied);
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  const migrate = database.transaction((filename: string) => {
    database.exec(readFileSync(`${migrationsDirectory}/${filename}`, "utf8"));
    if ((database.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("Migration foreign key validation failed");
    }
    database
      .prepare(
        "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
      )
      .run(filename, new Date().toISOString());
  });

  for (const filename of migrationFiles) {
    if (!appliedSet.has(filename)) {
      // Only the parent-table rebuild needs enforcement suspended; never inside a transaction.
      const rebuildsParent = filename === "005_google_sheets_sources.sql";
      if (rebuildsParent) database.pragma("foreign_keys = OFF");
      try {
        migrate(filename);
      } finally {
        if (rebuildsParent) database.pragma("foreign_keys = ON");
      }
    }
  }
}

export function initializeDatabase(
  filename: string,
  options: DatabaseOptions = {},
): Database.Database {
  const database = new Database(filename);
  try {
    database.pragma("foreign_keys = ON");
    database.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5_000}`);
    if (filename !== ":memory:") {
      database.pragma("journal_mode = WAL");
    }
    applyMigrations(
      database,
      options.migrationsDirectory ?? defaultMigrationsDirectory,
    );
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
