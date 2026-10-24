import type Database from "better-sqlite3";
import type { StudentActivitySnapshot, TeacherActivitySnapshot } from "@classroom-buzzer/shared";
import { ActivityRepository, GroupRepository, QuestionRepository } from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";

interface SubmissionRow {
  question_id: string;
  group_id: string;
  answer: string;
  server_received_at: string;
}

export class SnapshotService {
  private readonly activities: ActivityRepository;
  private readonly groups: GroupRepository;
  private readonly questions: QuestionRepository;

  constructor(private readonly database: Database.Database) {
    this.activities = new ActivityRepository(database);
    this.groups = new GroupRepository(database);
    this.questions = new QuestionRepository(database);
  }

  teacher(activityId: string): TeacherActivitySnapshot {
    try {
      return {
        ...this.base(activityId),
        role: "teacher",
        groups: this.groups.listByActivity(activityId).map(({ id, name }) => ({ id, name })),
        submissions: this.submissions(activityId).map((row) => ({
          questionId: row.question_id,
          groupId: row.group_id,
          answer: row.answer,
          serverReceivedAt: row.server_received_at,
        })),
      } satisfies TeacherActivitySnapshot;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  student(activityId: string, groupId: string): StudentActivitySnapshot {
    try {
      const group = this.groups.getById(groupId);
      if (group.activityId !== activityId) {
        throw new AppError(403, "ACTIVITY_SCOPE_FORBIDDEN", "不得存取其他活動或組別的資料。");
      }
      return {
        ...this.base(activityId),
        role: "student",
        group: { id: group.id, name: group.name },
        submissions: this.submissions(activityId)
          .filter((row) => row.group_id === groupId)
          .map((row) => ({
            questionId: row.question_id,
            answer: row.answer,
            serverReceivedAt: row.server_received_at,
          })),
      } satisfies StudentActivitySnapshot;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private base(activityId: string) {
    const activity = this.activities.getById(activityId);
    return {
      activityId: activity.id,
      state: activity.state,
      revision: activity.revision,
      questions: this.questions.listByActivity(activityId).map(({ id, displayNumber, sortOrder }) => ({ id, displayNumber, sortOrder })),
    };
  }

  private submissions(activityId: string): SubmissionRow[] {
    return this.database.prepare(
      `SELECT a.question_id, a.group_id, a.answer, a.server_received_at
       FROM current_submissions c
       JOIN submission_attempts a ON a.id = c.attempt_id
       WHERE c.activity_id = ?
       ORDER BY a.receive_sequence`,
    ).all(activityId) as SubmissionRow[];
  }
}
