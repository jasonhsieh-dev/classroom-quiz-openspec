import type Database from "better-sqlite3";
import {
  entityNotFound,
  RepositoryError,
  rethrowRepositoryError,
} from "./errors.js";

export interface GroupRecord {
  id: string;
  activityId: string;
  name: string;
  normalizedName: string;
  createdAt: string;
}

interface GroupRow {
  id: string;
  activity_id: string;
  name: string;
  normalized_name: string;
  created_at: string;
}

export interface CreateGroupInput {
  id: string;
  activityId: string;
  name: string;
  createdAt: string;
}

export function normalizeGroupName(name: string): string {
  return name.normalize("NFKC").trim();
}

function requireGroupName(name: string): {
  name: string;
  normalizedName: string;
} {
  const trimmedName = name.trim();
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) {
    throw new RepositoryError(
      "INVALID_DATA",
      "組別",
      "組別名稱去除前後空白後不得為空。",
    );
  }
  return { name: trimmedName, normalizedName };
}

function toGroupRecord(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    activityId: row.activity_id,
    name: row.name,
    normalizedName: row.normalized_name,
    createdAt: row.created_at,
  };
}

export class GroupRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: CreateGroupInput): GroupRecord {
    try {
      const { name, normalizedName } = requireGroupName(input.name);
      this.database
        .prepare(
          `INSERT INTO groups (
            id, activity_id, name, normalized_name, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.id, input.activityId, name, normalizedName, input.createdAt);
      return this.getById(input.id);
    } catch (error) {
      rethrowRepositoryError(error, "組別");
    }
  }

  findById(id: string): GroupRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM groups WHERE id = ?")
      .get(id) as GroupRow | undefined;
    return row ? toGroupRecord(row) : undefined;
  }

  getById(id: string): GroupRecord {
    const group = this.findById(id);
    if (!group) throw entityNotFound("組別", id);
    return group;
  }

  listByActivity(activityId: string): GroupRecord[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM groups WHERE activity_id = ? ORDER BY created_at, id",
        )
        .all(activityId) as GroupRow[]
    ).map(toGroupRecord);
  }

  rename(id: string, name: string): GroupRecord {
    try {
      const normalized = requireGroupName(name);
      const result = this.database
        .prepare(
          "UPDATE groups SET name = ?, normalized_name = ? WHERE id = ?",
        )
        .run(normalized.name, normalized.normalizedName, id);
      if (result.changes === 0) throw entityNotFound("組別", id);
      return this.getById(id);
    } catch (error) {
      rethrowRepositoryError(error, "組別");
    }
  }

  delete(id: string): void {
    try {
      const result = this.database.prepare("DELETE FROM groups WHERE id = ?").run(id);
      if (result.changes === 0) throw entityNotFound("組別", id);
    } catch (error) {
      rethrowRepositoryError(error, "組別");
    }
  }
}
