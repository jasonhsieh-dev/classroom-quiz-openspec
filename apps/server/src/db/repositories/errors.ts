export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "FOREIGN_KEY_VIOLATION"
  | "INVALID_DATA";

export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    readonly entity: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryError";
  }
}

export function entityNotFound(entity: string, id: string): RepositoryError {
  return new RepositoryError(
    "NOT_FOUND",
    entity,
    `找不到 ${entity}（${id}）。`,
  );
}

function sqliteErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export function rethrowRepositoryError(error: unknown, entity: string): never {
  if (error instanceof RepositoryError) {
    throw error;
  }

  const code = sqliteErrorCode(error);
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    throw new RepositoryError(
      "FOREIGN_KEY_VIOLATION",
      entity,
      `${entity} 參照了不存在或不相符的資料。`,
      { cause: error },
    );
  }
  if (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  ) {
    throw new RepositoryError(
      "CONFLICT",
      entity,
      `${entity} 與既有資料衝突。`,
      { cause: error },
    );
  }
  if (
    code === "SQLITE_CONSTRAINT_CHECK" ||
    code === "SQLITE_CONSTRAINT_NOTNULL"
  ) {
    throw new RepositoryError(
      "INVALID_DATA",
      entity,
      `${entity} 資料不符合限制。`,
      { cause: error },
    );
  }

  throw error;
}
