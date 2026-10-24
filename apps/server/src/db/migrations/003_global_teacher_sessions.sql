CREATE TABLE sessions_next (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  activity_id TEXT,
  group_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id, activity_id) REFERENCES groups(id, activity_id),
  CHECK (
    (role = 'teacher' AND activity_id IS NULL AND group_id IS NULL)
    OR (
      role = 'student'
      AND activity_id IS NOT NULL
      AND group_id IS NOT NULL
    )
  )
);

INSERT INTO sessions_next (
  id, role, activity_id, group_id, created_at, expires_at
)
SELECT
  id,
  role,
  CASE WHEN role = 'teacher' THEN NULL ELSE activity_id END,
  CASE WHEN role = 'teacher' THEN NULL ELSE group_id END,
  created_at,
  expires_at
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_next RENAME TO sessions;
