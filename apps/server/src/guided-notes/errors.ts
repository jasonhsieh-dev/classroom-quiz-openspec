export type GuidedNotesErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "INVALID_XLSX"
  | "HEADER_NOT_FOUND"
  | "HEADER_AMBIGUOUS"
  | "NO_QUESTIONS"
  | "DUPLICATE_QUESTION_NUMBER"
  | "INVALID_ANSWER_MAPPING"
  | "OVERLAPPING_ANSWER_RANGES";

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
