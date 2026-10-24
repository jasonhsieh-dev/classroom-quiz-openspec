import type Database from "better-sqlite3";
import type { SubmissionResponse } from "@classroom-buzzer/shared";
import type { SessionRecord } from "../db/repositories/index.js";
import {
  ActivityRepository,
  QuestionRepository,
  SubmissionRepository,
} from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";

export const DEFAULT_MAX_ANSWER_LENGTH = 2_000;

interface SubmitInput {
  questionId: string;
  answer: unknown;
  idempotencyKey: unknown;
}

interface SubmissionServiceOptions {
  clock?: () => string;
  maxAnswerLength?: number;
}

export class SubmissionService {
  private readonly activities: ActivityRepository;
  private readonly questions: QuestionRepository;
  private readonly submissions: SubmissionRepository;
  private readonly clock: () => string;
  private readonly maxAnswerLength: number;

  constructor(
    private readonly database: Database.Database,
    options: SubmissionServiceOptions = {},
  ) {
    this.activities = new ActivityRepository(database);
    this.questions = new QuestionRepository(database);
    this.submissions = new SubmissionRepository(database);
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.maxAnswerLength = options.maxAnswerLength ?? DEFAULT_MAX_ANSWER_LENGTH;
  }

  submit(session: SessionRecord, input: SubmitInput): SubmissionResponse {
    if (session.role !== "student" || !session.activityId || !session.groupId) {
      throw new AppError(403, "STUDENT_SESSION_REQUIRED", "需要有效的學生 session 才能提交答案。");
    }
    const answer = this.requireAnswer(input.answer);
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);

    try {
      return this.database.transaction(() => {
        const existing = this.submissions.findByIdempotency(
          session.id,
          input.questionId,
          idempotencyKey,
        );
        if (existing) {
          if (existing.answer !== answer) {
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "相同提交識別碼已用於不同答案，請使用新的提交識別碼。",
            );
          }
          return this.response(existing);
        }

        const activity = this.activities.getById(session.activityId!);
        if (activity.state !== "OPEN") {
          throw new AppError(
            409,
            activity.state === "CLOSED" ? "ACTIVITY_CLOSED" : "ACTIVITY_NOT_OPEN",
            activity.state === "CLOSED" ? "活動已結束，不得再提交或修改答案。" : "活動尚未開始，暫時不能提交答案。",
          );
        }
        const question = this.questions.findById(input.questionId);
        if (!question || question.activityId !== activity.id) {
          throw new AppError(404, "QUESTION_NOT_FOUND", "找不到此活動的題目。");
        }

        const update = this.database.prepare(
          `UPDATE activities
           SET next_receive_sequence = next_receive_sequence + 1,
               revision = revision + 1
           WHERE id = ? AND state = 'OPEN'`,
        ).run(activity.id);
        if (update.changes !== 1) {
          throw new AppError(409, "ACTIVITY_STATE_CHANGED", "活動狀態已變更，請重新整理。");
        }
        const updated = this.activities.getById(activity.id);
        const attempt = this.submissions.createAttempt({
          activityId: activity.id,
          questionId: question.id,
          groupId: session.groupId!,
          sessionId: session.id,
          answer,
          serverReceivedAt: this.clock(),
          receiveSequence: updated.nextReceiveSequence,
          idempotencyKey,
        });
        this.submissions.setCurrent(attempt);
        return this.response(attempt);
      }).immediate();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private requireAnswer(value: unknown): string {
    if (typeof value !== "string") {
      throw new AppError(400, "ANSWER_REQUIRED", "請輸入答案。");
    }
    const answer = value.trim();
    if (!answer) throw new AppError(400, "ANSWER_REQUIRED", "答案去除前後空白後不得為空。");
    if ([...answer].length > this.maxAnswerLength) {
      throw new AppError(400, "ANSWER_TOO_LONG", `答案不得超過 ${this.maxAnswerLength} 字。`);
    }
    return answer;
  }

  private requireIdempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "提交識別碼不可空白。");
    }
    const key = value.trim();
    if (key.length > 200) {
      throw new AppError(400, "IDEMPOTENCY_KEY_TOO_LONG", "提交識別碼不得超過 200 字元。");
    }
    return key;
  }

  private response(
    attempt: { questionId: string; answer: string; serverReceivedAt: string },
  ): SubmissionResponse {
    return {
      questionId: attempt.questionId,
      answer: attempt.answer,
      serverReceivedAt: attempt.serverReceivedAt,
    };
  }
}
