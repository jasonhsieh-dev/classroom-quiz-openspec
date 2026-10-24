import type Database from "better-sqlite3";
import type { ActivityRecord } from "../db/repositories/index.js";
import { ActivityRepository, GroupRepository, QuestionRepository } from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";

export class ActivityLifecycleService {
  private readonly activities: ActivityRepository;
  private readonly groups: GroupRepository;
  private readonly questions: QuestionRepository;

  constructor(
    private readonly database: Database.Database,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.activities = new ActivityRepository(database);
    this.groups = new GroupRepository(database);
    this.questions = new QuestionRepository(database);
  }

  open(activityId: string): ActivityRecord {
    try {
      return this.database.transaction(() => {
        const activity = this.activities.getById(activityId);
        if (activity.state !== "DRAFT") {
          throw new AppError(409, "ACTIVITY_NOT_DRAFT", "只有草稿活動可以開始。");
        }
        const questions = this.questions.listByActivity(activityId);
        const missing: string[] = [];
        if (questions.length === 0) missing.push("至少一題");
        if (this.groups.listByActivity(activityId).length === 0) missing.push("至少一個組別");
        if (
          questions.some((question) =>
            [question.sheetName, question.numberCell, question.answerRange, question.answerAnchor]
              .some((value) => value.trim().length === 0),
          )
        ) {
          missing.push("有效的題目 mapping");
        }
        if (missing.length > 0) {
          throw new AppError(409, "ACTIVITY_NOT_READY", `活動尚未完成設定：${missing.join("、")}。`, { missing });
        }
        const openActivity = this.database
          .prepare("SELECT id, title FROM activities WHERE state = 'OPEN' LIMIT 1")
          .get() as { id: string; title: string } | undefined;
        if (openActivity) {
          throw new AppError(409, "ANOTHER_ACTIVITY_OPEN", `目前已有開放中的活動：${openActivity.title}。`, { activityId: openActivity.id });
        }
        const result = this.database.prepare(
          `UPDATE activities
           SET state = 'OPEN', opened_at = ?, revision = revision + 1
           WHERE id = ? AND state = 'DRAFT'`,
        ).run(this.clock(), activityId);
        if (result.changes !== 1) {
          throw new AppError(409, "ACTIVITY_STATE_CHANGED", "活動狀態已變更，請重新整理。");
        }
        return this.activities.getById(activityId);
      }).immediate();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }
}
