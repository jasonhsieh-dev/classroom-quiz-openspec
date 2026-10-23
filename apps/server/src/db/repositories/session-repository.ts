import type { Role } from "@classroom-buzzer/shared";
import type Database from "better-sqlite3";
import {
  entityNotFound,
  rethrowRepositoryError,
} from "./errors.js";

export interface SessionRecord {
  id: string;
  role: Role;
  activityId: string;
  groupId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  role: Role;
  activity_id: string;
  group_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface CreateSessionInput {
  id: string;
  role: Role;
  activityId: string;
  groupId: string | null;
  createdAt: string;
  expiresAt: string;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    role: row.role,
    activityId: row.activity_id,
    groupId: row.group_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class SessionRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: CreateSessionInput): SessionRecord {
    try {
      this.database
        .prepare(
          `INSERT INTO sessions (
            id, role, activity_id, group_id, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.role,
          input.activityId,
          input.groupId,
          input.createdAt,
          input.expiresAt,
        );
      return this.getById(input.id);
    } catch (error) {
      rethrowRepositoryError(error, "Session");
    }
  }

  findById(id: string): SessionRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    return row ? toSessionRecord(row) : undefined;
  }

  getById(id: string): SessionRecord {
    const session = this.findById(id);
    if (!session) throw entityNotFound("Session", id);
    return session;
  }

  listByActivity(activityId: string): SessionRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM sessions WHERE activity_id = ? ORDER BY created_at, id",
        )
        .all(activityId) as SessionRow[]
    ).map(toSessionRecord);
  }

  updateExpiration(id: string, expiresAt: string): SessionRecord {
    try {
      const result = this.database
        .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .run(expiresAt, id);
      if (result.changes === 0) throw entityNotFound("Session", id);
      return this.getById(id);
    } catch (error) {
      rethrowRepositoryError(error, "Session");
    }
  }
}
