import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@classroom-buzzer/shared";
import { createApp } from "./app.js";
import {
  ensureRuntimeDirectories,
  resolveRuntimePaths,
} from "./config/runtime-paths.js";
import { initializeDatabase } from "./db/database.js";
import { registerApplicationRoutes } from "./application-routes.js";
import { GuidedNotesImportService } from "./guided-notes/import-service.js";
import { backfillQuestionPrompts } from "./guided-notes/prompt-backfill.js";
import { SessionService } from "./auth/session-auth.js";
import {
  configureSocketServer,
  type ActivityEventPublisher,
  type ClassroomSocketServer,
} from "./realtime/socket-server.js";

export async function startServer(environment: NodeJS.ProcessEnv = process.env) {
  const runtimePaths = resolveRuntimePaths(environment);
  await ensureRuntimeDirectories(runtimePaths);
  const database = initializeDatabase(
    join(runtimePaths.data, "classroom-quiz.sqlite"),
  );
  await backfillQuestionPrompts(database);
  const guidedNotesImports = new GuidedNotesImportService(database, runtimePaths);
  await guidedNotesImports.cleanupExpired();
  const sessions = new SessionService(database);
  let realtime: ActivityEventPublisher | undefined;
  const eventRelay: ActivityEventPublisher = {
    opened: (event) => realtime?.opened(event),
    closed: (event) => realtime?.closed(event),
    submission: (event) => realtime?.submission(event),
  };
  const app = createApp({
    registerRoutes(instance) {
      registerApplicationRoutes(instance, database, runtimePaths, {
        guidedNotesImports,
        sessions,
        events: eventRelay,
      });
    },
  });
  const httpServer = createServer(app);
  const io: ClassroomSocketServer = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents
  >(httpServer);
  realtime = configureSocketServer(io, database, sessions);

  const rawPort = environment.CLASSROOM_BUZZER_PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    database.close();
    throw new Error("CLASSROOM_BUZZER_PORT 必須是 1 到 65535 的整數。");
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    app,
    database,
    httpServer,
    io,
    port,
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      database.close();
    },
  };
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startServer()
    .then(({ port }) => {
      console.log(`課堂搶答系統伺服器已啟動：http://127.0.0.1:${port}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "未知錯誤";
      console.error(`伺服器啟動失敗：${message}`);
      process.exitCode = 1;
    });
}
