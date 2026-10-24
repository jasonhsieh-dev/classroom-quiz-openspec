CREATE TABLE import_drafts (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  temp_file_path TEXT NOT NULL UNIQUE,
  source_sha256 TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX import_drafts_expires_at
  ON import_drafts (expires_at);
