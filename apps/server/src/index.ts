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

export async function startServer(environment: NodeJS.ProcessEnv = process.env) {
  const runtimePaths = resolveRuntimePaths(environment);
  await ensureRuntimeDirectories(runtimePaths);
  const database = initializeDatabase(
    join(runtimePaths.data, "classroom-quiz.sqlite"),
  );
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents
  >(httpServer);

  io.on("connection", (socket) => {
    socket.on("connection.ready", (acknowledge) => acknowledge({ ready: true }));
  });

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
