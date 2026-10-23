CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'OPEN', 'CLOSED')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_receive_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_receive_sequence >= 0),
  source_file_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX activities_single_open
  ON activities ((1))
  WHERE state = 'OPEN';

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  UNIQUE (id, activity_id),
  UNIQUE (activity_id, normalized_name)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  activity_id TEXT NOT NULL,
  group_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, activity_id) REFERENCES groups(id, activity_id),
  CHECK (
    (role = 'teacher' AND group_id IS NULL)
    OR (role = 'student' AND group_id IS NOT NULL)
  )
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  display_number TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  sheet_name TEXT NOT NULL,
  number_cell TEXT NOT NULL,
  answer_range TEXT NOT NULL,
  answer_anchor TEXT NOT NULL,
  original_answer TEXT,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  UNIQUE (id, activity_id),
  UNIQUE (activity_id, display_number),
  UNIQUE (activity_id, sort_order)
);

CREATE TABLE submission_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  receive_sequence INTEGER NOT NULL CHECK (receive_sequence > 0),
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, activity_id) REFERENCES questions(id, activity_id),
  FOREIGN KEY (group_id, activity_id) REFERENCES groups(id, activity_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE RESTRICT,
  UNIQUE (activity_id, receive_sequence),
  UNIQUE (session_id, question_id, idempotency_key)
);

CREATE TABLE current_submissions (
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  attempt_id INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (question_id, group_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, activity_id) REFERENCES questions(id, activity_id),
  FOREIGN KEY (group_id, activity_id) REFERENCES groups(id, activity_id),
  FOREIGN KEY (attempt_id) REFERENCES submission_attempts(id) ON DELETE RESTRICT
);

CREATE TABLE result_entries (
  activity_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  attempt_id INTEGER NOT NULL UNIQUE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  PRIMARY KEY (question_id, group_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, activity_id) REFERENCES questions(id, activity_id),
  FOREIGN KEY (group_id, activity_id) REFERENCES groups(id, activity_id),
  FOREIGN KEY (attempt_id) REFERENCES submission_attempts(id) ON DELETE RESTRICT,
  UNIQUE (question_id, rank)
);

CREATE TABLE export_records (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  output_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
