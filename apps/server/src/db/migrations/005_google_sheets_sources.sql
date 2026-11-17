-- Parent table rebuild: migration runner disables FK enforcement outside the transaction,
-- then checks all references before commit and restores enforcement.
CREATE TABLE activities_next (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'OPEN', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_receive_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_receive_sequence >= 0),
  source_kind TEXT NOT NULL DEFAULT 'legacy-xlsx' CHECK (source_kind IN ('legacy-xlsx', 'google-sheets')),
  source_file_path TEXT,
  source_sha256 TEXT,
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((source_kind = 'legacy-xlsx' AND source_file_path IS NOT NULL AND source_sha256 IS NOT NULL)
    OR (source_kind = 'google-sheets' AND source_file_path IS NULL AND source_sha256 IS NULL))
);
INSERT INTO activities_next
  (id,title,state,revision,next_receive_sequence,source_file_path,source_sha256,opened_at,closed_at,created_at)
SELECT id,title,state,revision,next_receive_sequence,source_file_path,source_sha256,opened_at,closed_at,created_at FROM activities;
DROP TABLE activities;
ALTER TABLE activities_next RENAME TO activities;
CREATE UNIQUE INDEX activities_single_open ON activities ((1)) WHERE state = 'OPEN';

CREATE TABLE google_sheets_sources (
  activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL CHECK (length(spreadsheet_id) > 0),
  sheet_id INTEGER NOT NULL CHECK (sheet_id >= 0),
  sheet_title TEXT NOT NULL,
  structure_fingerprint TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json)),
  original_answers_json TEXT NOT NULL CHECK (json_valid(original_answers_json)),
  created_at TEXT NOT NULL
);
CREATE TRIGGER google_sheets_source_kind BEFORE INSERT ON google_sheets_sources
WHEN (SELECT source_kind FROM activities WHERE id = NEW.activity_id) != 'google-sheets'
BEGIN SELECT RAISE(ABORT, 'Cloud source requires google-sheets activity'); END;

CREATE TABLE google_sheets_import_drafts (
  id TEXT PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  sheet_id INTEGER NOT NULL CHECK (sheet_id >= 0),
  sheet_title TEXT NOT NULL,
  structure_fingerprint TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  mapping_json TEXT NOT NULL CHECK (json_valid(mapping_json)),
  original_answers_json TEXT NOT NULL CHECK (json_valid(original_answers_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE google_sheets_writebacks (
  operation_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES google_sheets_sources(activity_id) ON DELETE CASCADE,
  result_version INTEGER NOT NULL CHECK (result_version >= 0),
  payload_hash TEXT NOT NULL,
  targets_json TEXT NOT NULL CHECK (json_valid(targets_json)),
  state TEXT NOT NULL CHECK (state IN ('PREPARED','IN_FLIGHT','SUCCEEDED','FAILED','UNKNOWN','CONFLICT')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (activity_id, result_version)
);
