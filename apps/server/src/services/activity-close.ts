import type Database from "better-sqlite3";
import {
  ActivityRepository,
  ResultRepository,
} from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";

export interface CloseActivityResult {
  activityId: string;
  state: "CLOSED";
  revision: number;
  closedAt: string;
  resultCount: number;
}

export class ActivityCloseService {
  private readonly activities: ActivityRepository;
  private readonly results: ResultRepository;

  constructor(
    private readonly database: Database.Database,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.activities = new ActivityRepository(database);
    this.results = new ResultRepository(database);
  }

  close(activityId: string): CloseActivityResult {
    try {
      return this.database.transaction(() => {
        const activity = this.activities.getById(activityId);
        if (activity.state === "CLOSED") {
          return this.response(activityId);
        }
        if (activity.state !== "OPEN") {
          throw new AppError(409, "ACTIVITY_NOT_OPEN", "只有進行中的活動可以結束。");
        }

        const closedAt = this.clock();
        const update = this.database.prepare(
          `UPDATE activities
           SET state = 'CLOSED', closed_at = ?, revision = revision + 1
           WHERE id = ? AND state = 'OPEN'`,
        ).run(closedAt, activityId);
        if (update.changes !== 1) {
          throw new AppError(409, "ACTIVITY_STATE_CHANGED", "活動狀態已變更，請重新整理。");
        }

        this.results.createFromCurrentSubmissions(activityId);
        return this.response(activityId);
      }).immediate();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private response(activityId: string): CloseActivityResult {
    const activity = this.activities.getById(activityId);
    if (activity.state !== "CLOSED" || !activity.closedAt) {
      throw new AppError(500, "CLOSE_RESULT_INVALID", "活動截止結果不完整。");
    }
    return {
      activityId: activity.id,
      state: "CLOSED",
      revision: activity.revision,
      closedAt: activity.closedAt,
      resultCount: this.results.listByActivity(activityId).length,
    };
  }
}
