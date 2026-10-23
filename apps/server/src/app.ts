import express, { type Express } from "express";
import type { HealthResponse } from "@classroom-buzzer/shared";
import { errorHandler, notFoundHandler } from "./errors.js";

interface CreateAppOptions {
  registerRoutes?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    const body: HealthResponse = {
      status: "ok",
      service: "classroom-buzzer-server",
    };
    response.json(body);
  });

  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
