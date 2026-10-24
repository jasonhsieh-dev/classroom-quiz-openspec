import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiError } from "@classroom-buzzer/shared";
import { RepositoryError } from "./db/repositories/errors.js";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function repositoryErrorToAppError(error: unknown): AppError {
  if (!(error instanceof RepositoryError)) {
    return new AppError(500, "INTERNAL_ERROR", "伺服器發生未預期錯誤。");
  }
  const status =
    error.code === "NOT_FOUND"
      ? 404
      : error.code === "CONFLICT"
        ? 409
        : 400;
  return new AppError(status, `REPOSITORY_${error.code}`, error.message);
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  const body: ApiError = {
    error: {
      code: "NOT_FOUND",
      message: "找不到要求的資源。",
    },
  };
  response.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  const appError = error instanceof AppError ? error : undefined;
  const body: ApiError = {
    error: {
      code: appError?.code ?? "INTERNAL_ERROR",
      message: appError?.message ?? "伺服器發生未預期錯誤。",
      ...(appError?.details ? { details: appError.details } : {}),
    },
  };

  response.status(appError?.status ?? 500).json(body);
};
