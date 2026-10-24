import { Router, type Request } from "express";
import type { GroupListResponse, GroupSummary } from "@classroom-buzzer/shared";
import type Database from "better-sqlite3";
import { ActivityRepository } from "../db/repositories/index.js";
import { AppError, repositoryErrorToAppError } from "../errors.js";
import { GroupService } from "../services/group-service.js";

function requireName(body: unknown): string {
  if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string") {
    throw new AppError(400, "GROUP_NAME_REQUIRED", "請輸入組別名稱。");
  }
  return body.name;
}

function summary(group: { id: string; name: string }): GroupSummary {
  return { id: group.id, name: group.name };
}

function activityId(request: Request): string {
  return (request.params as Record<string, string>).activityId!;
}

export function createTeacherGroupRouter(service: GroupService): Router {
  const router = Router({ mergeParams: true });
  router.get("/", (request, response, next) => {
    try {
      response.json(service.list(activityId(request)).map(summary));
    } catch (error) {
      next(error);
    }
  });
  router.post("/", (request, response, next) => {
    try {
      response.status(201).json(summary(service.create(activityId(request), requireName(request.body))));
    } catch (error) {
      next(error);
    }
  });
  router.patch("/:groupId", (request, response, next) => {
    try {
      response.json(summary(service.rename(activityId(request), request.params.groupId!, requireName(request.body))));
    } catch (error) {
      next(error);
    }
  });
  router.delete("/:groupId", (request, response, next) => {
    try {
      service.delete(activityId(request), request.params.groupId!);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createPublicActivityRouter(database: Database.Database): Router {
  const router = Router();
  const groups = new GroupService(database);
  const activities = new ActivityRepository(database);
  router.get("/:activityId/join", (request, response, next) => {
    try {
      const activity = activities.getById(request.params.activityId!);
      const body: GroupListResponse = {
        activityId: activity.id,
        state: activity.state,
        revision: activity.revision,
        groups: groups.list(activity.id).map(summary),
      };
      response.json(body);
    } catch (error) {
      next(error instanceof AppError ? error : repositoryErrorToAppError(error));
    }
  });
  return router;
}
