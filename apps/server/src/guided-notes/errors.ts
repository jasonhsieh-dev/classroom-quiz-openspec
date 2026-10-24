export type GuidedNotesErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_XLSX"
  | "HEADER_NOT_FOUND"
  | "HEADER_AMBIGUOUS"
  | "NO_QUESTIONS"
  | "DUPLICATE_QUESTION_NUMBER"
  | "INVALID_ANSWER_MAPPING"
  | "OVERLAPPING_ANSWER_RANGES"
  | "IMPORT_DRAFT_NOT_FOUND"
  | "IMPORT_DRAFT_EXPIRED"
  | "IMPORT_DRAFT_CORRUPT"
  | "SOURCE_FILE_MISMATCH"
  | "INVALID_ACTIVITY_TITLE";

export class GuidedNotesError extends Error {
  constructor(
    readonly code: GuidedNotesErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GuidedNotesError";
  }
}
