import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ActivityRepository,
  GroupRepository,
  SessionRepository,
  type GroupRecord,
} from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";
import { ActivityStateService } from "./activity-state.js";

interface GroupServiceOptions {
  now?: () => string;
  idFactory?: () => string;
}

export interface BatchGroupResult {
  activityId: string;
  state: "DRAFT";
  revision: number;
  groups: GroupRecord[];
}

export class GroupService {
  private readonly activities: ActivityRepository;
  private readonly groups: GroupRepository;
  private readonly states: ActivityStateService;
  private readonly sessions: SessionRepository;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: Database.Database,
    options: GroupServiceOptions = {},
  ) {
    this.activities = new ActivityRepository(database);
    this.groups = new GroupRepository(database);
    this.states = new ActivityStateService(database);
    this.sessions = new SessionRepository(database);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  list(activityId: string): GroupRecord[] {
    this.requireActivity(activityId);
    return this.groups.listByActivity(activityId);
  }

  create(activityId: string, name: string): GroupRecord {
    return this.mutate(activityId, () =>
      this.groups.create({
        id: this.idFactory(),
        activityId,
        name,
        createdAt: this.now(),
      }),
    );
  }

  rename(activityId: string, groupId: string, name: string): GroupRecord {
    return this.mutate(activityId, () => {
      this.requireGroup(activityId, groupId);
      return this.groups.rename(groupId, name);
    });
  }

  delete(activityId: string, groupId: string): void {
    this.mutate(activityId, () => {
      this.requireGroup(activityId, groupId);
      this.groups.delete(groupId);
    });
  }

  replace(activityId: string, count: number): BatchGroupResult {
    try {
      return this.database.transaction(() => {
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          throw new AppError(
            400,
            "GROUP_COUNT_INVALID",
            "組別數量必須是 1 至 100 的整數。",
          );
        }
        const activity = this.requireActivity(activityId);
        if (activity.state !== "DRAFT") {
          throw new AppError(
            409,
            "GROUPS_LOCKED",
            "活動開始或結束後不得修改組別。",
          );
        }
        if (this.sessions.listByActivity(activityId).some((session) => session.role === "student")) {
          throw new AppError(
            409,
            "GROUPS_IN_USE",
            "已有學生選擇組別，為避免破壞 session 綁定，不能重新產生組別。",
          );
        }

        this.groups.deleteByActivity(activityId);
        const groups = Array.from({ length: count }, (_, index) =>
          this.groups.create({
            id: this.idFactory(),
            activityId,
            name: `第 ${index + 1} 組`,
            createdAt: this.now(),
          }),
        );
        const updated = this.states.incrementRevision(activityId);
        return {
          activityId,
          state: "DRAFT" as const,
          revision: updated.revision,
          groups,
        };
      }).immediate();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private mutate<T>(activityId: string, operation: () => T): T {
    try {
      return this.database.transaction(() => {
        const activity = this.requireActivity(activityId);
        if (activity.state !== "DRAFT") {
          throw new AppError(
            409,
            "GROUPS_LOCKED",
            "活動開始或結束後不得修改組別。",
          );
        }
        const result = operation();
        this.states.incrementRevision(activityId);
        return result;
      })();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw repositoryErrorToAppError(error);
    }
  }

  private requireActivity(activityId: string) {
    try {
      return this.activities.getById(activityId);
    } catch (error) {
      throw repositoryErrorToAppError(error);
    }
  }

  private requireGroup(activityId: string, groupId: string): GroupRecord {
    let group: GroupRecord;
    try {
      group = this.groups.getById(groupId);
    } catch (error) {
      throw repositoryErrorToAppError(error);
    }
    if (group.activityId !== activityId) {
      throw new AppError(404, "GROUP_NOT_FOUND", "找不到此活動的組別。");
    }
    return group;
  }
}
