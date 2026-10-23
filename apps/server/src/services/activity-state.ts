import type { ActivityState } from "@classroom-buzzer/shared";
import type Database from "better-sqlite3";
import {
  ActivityRepository,
  type ActivityRecord,
  RepositoryError,
  rethrowRepositoryError,
} from "../db/repositories/index.js";

export class ActivityStateTransitionError extends Error {
  readonly code = "INVALID_ACTIVITY_STATE_TRANSITION";

  constructor(
    readonly activityId: string,
    readonly currentState: ActivityState,
    readonly targetState: ActivityState,
  ) {
    super(
      `活動 ${activityId} 不允許從 ${currentState} 轉換為 ${targetState}。`,
    );
    this.name = "ActivityStateTransitionError";
  }
}

export type ServerClock = () => string;

export class ActivityStateService {
  private readonly activities: ActivityRepository;

  constructor(
    private readonly database: Database.Database,
    private readonly clock: ServerClock = () => new Date().toISOString(),
  ) {
    this.activities = new ActivityRepository(database);
  }

  transition(activityId: string, targetState: ActivityState): ActivityRecord {
    return this.database.transaction(() => {
      const current = this.activities.getById(activityId);

      if (current.state === "CLOSED" && targetState === "CLOSED") {
        return current;
      }

      const expectedState =
        targetState === "OPEN"
          ? "DRAFT"
          : targetState === "CLOSED"
            ? "OPEN"
            : undefined;

      if (!expectedState || current.state !== expectedState) {
        throw new ActivityStateTransitionError(
          activityId,
          current.state,
          targetState,
        );
      }

      const receivedAt = this.clock();
      try {
        const result =
          targetState === "OPEN"
            ? this.database
                .prepare(
                  `UPDATE activities
                   SET state = 'OPEN', opened_at = ?, revision = revision + 1
                   WHERE id = ? AND state = 'DRAFT'`,
                )
                .run(receivedAt, activityId)
            : this.database
                .prepare(
                  `UPDATE activities
                   SET state = 'CLOSED', closed_at = ?, revision = revision + 1
                   WHERE id = ? AND state = 'OPEN'`,
                )
                .run(receivedAt, activityId);

        if (result.changes !== 1) {
          const latest = this.activities.getById(activityId);
          throw new ActivityStateTransitionError(
            activityId,
            latest.state,
            targetState,
          );
        }
      } catch (error) {
        rethrowRepositoryError(error, "活動狀態");
      }

      return this.activities.getById(activityId);
    })();
  }

  incrementRevision(activityId: string): ActivityRecord {
    return this.database.transaction(() => {
      try {
        const result = this.database
          .prepare(
            "UPDATE activities SET revision = revision + 1 WHERE id = ?",
          )
          .run(activityId);
        if (result.changes === 0) {
          throw new RepositoryError(
            "NOT_FOUND",
            "活動",
            `找不到活動（${activityId}）。`,
          );
        }
        return this.activities.getById(activityId);
      } catch (error) {
        rethrowRepositoryError(error, "活動 revision");
      }
    })();
  }
}
