import type Database from "better-sqlite3";
import type {
  StudentActivityResults,
  TeacherActivityResults,
} from "@classroom-buzzer/shared";
import {
  ActivityRepository,
  GroupRepository,
  QuestionRepository,
} from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";

interface DetailedResultRow {
  question_id: string;
  group_id: string;
  group_name: string;
  answer: string;
  server_received_at: string;
  rank: number;
}

export class ResultService {
  private readonly activities: ActivityRepository;
  private readonly groups: GroupRepository;
  private readonly questions: QuestionRepository;

  constructor(private readonly database: Database.Database) {
    this.activities = new ActivityRepository(database);
    this.groups = new GroupRepository(database);
    this.questions = new QuestionRepository(database);
  }

  teacher(activityId: string): TeacherActivityResults {
    try {
      const activity = this.requireClosed(activityId);
      const rows = this.rows(activityId);
      return {
        activityId,
        revision: activity.revision,
        closedAt: activity.closedAt!,
        questions: this.questions.listByActivity(activityId).map((question) => {
          const questionRows = rows.filter((row) => row.question_id === question.id);
          return {
            question: {
              id: question.id,
              displayNumber: question.displayNumber,
              sortOrder: question.sortOrder,
            },
            winner: questionRows[0]
              ? { id: questionRows[0].group_id, name: questionRows[0].group_name }
              : null,
            rankings: questionRows.map((row) => ({
              group: { id: row.group_id, name: row.group_name },
              rank: row.rank,
              answer: row.answer,
              serverReceivedAt: row.server_received_at,
            })),
          };
        }),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  student(activityId: string, groupId: string): StudentActivityResults {
    try {
      const activity = this.requireClosed(activityId);
      const group = this.groups.getById(groupId);
      if (group.activityId !== activityId) {
        throw new AppError(403, "ACTIVITY_SCOPE_FORBIDDEN", "不得存取其他活動或組別的資料。");
      }
      const rows = this.rows(activityId);
      return {
        activityId,
        revision: activity.revision,
        closedAt: activity.closedAt!,
        group: { id: group.id, name: group.name },
        questions: this.questions.listByActivity(activityId).map((question) => {
          const questionRows = rows.filter((row) => row.question_id === question.id);
          const own = questionRows.find((row) => row.group_id === groupId);
          return {
            question: {
              id: question.id,
              displayNumber: question.displayNumber,
              sortOrder: question.sortOrder,
            },
            winner: questionRows[0]
              ? { id: questionRows[0].group_id, name: questionRows[0].group_name }
              : null,
            ownResult: own
              ? { status: "ANSWERED" as const, answer: own.answer, rank: own.rank }
              : { status: "NOT_ANSWERED" as const },
          };
        }),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private requireClosed(activityId: string) {
    const activity = this.activities.getById(activityId);
    if (activity.state !== "CLOSED" || !activity.closedAt) {
      throw new AppError(409, "RESULTS_NOT_AVAILABLE", "活動尚未結束，不能查看最終結果。");
    }
    return activity;
  }

  private rows(activityId: string): DetailedResultRow[] {
    return this.database.prepare(
      `SELECT
         result.question_id,
         result.group_id,
         groups.name AS group_name,
         attempt.answer,
         attempt.server_received_at,
         result.rank
       FROM result_entries AS result
       JOIN groups
         ON groups.id = result.group_id
        AND groups.activity_id = result.activity_id
       JOIN submission_attempts AS attempt
         ON attempt.id = result.attempt_id
        AND attempt.activity_id = result.activity_id
        AND attempt.question_id = result.question_id
        AND attempt.group_id = result.group_id
       WHERE result.activity_id = ?
       ORDER BY result.question_id, result.rank`,
    ).all(activityId) as DetailedResultRow[];
  }
}
