import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureRuntimeDirectories,
  projectRoot,
  resolveRuntimePaths,
  RuntimeConfigurationError,
} from "./runtime-paths.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("執行期目錄", () => {
  it("預設將執行期資料放在專案根目錄的 var 下", () => {
    expect(resolveRuntimePaths({})).toEqual({
      data: join(projectRoot, "var/data"),
      uploads: join(projectRoot, "var/uploads"),
      exports: join(projectRoot, "var/exports"),
    });
  });

  it("使用可配置路徑並建立必要目錄", async () => {
    const base = await mkdtemp(join(tmpdir(), "classroom-buzzer-runtime-"));
    temporaryDirectories.push(base);
    const paths = resolveRuntimePaths(
      {
        CLASSROOM_BUZZER_DATA_DIR: "runtime/database",
        CLASSROOM_BUZZER_UPLOAD_DIR: "runtime/uploads",
        CLASSROOM_BUZZER_EXPORT_DIR: "runtime/exports",
      },
      base,
    );

    await ensureRuntimeDirectories(paths);

    await expect(stat(paths.data)).resolves.toMatchObject({});
    await expect(stat(paths.uploads)).resolves.toMatchObject({});
    await expect(stat(paths.exports)).resolves.toMatchObject({});
  });

  it("對空白必要設定提供明確且不含絕對路徑的錯誤", () => {
    expect(() =>
      resolveRuntimePaths({ CLASSROOM_BUZZER_DATA_DIR: " " }, "C:\\private"),
    ).toThrow(RuntimeConfigurationError);

    try {
      resolveRuntimePaths({ CLASSROOM_BUZZER_DATA_DIR: " " }, "C:\\private");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigurationError);
      expect((error as Error).message).toContain("CLASSROOM_BUZZER_DATA_DIR");
      expect((error as Error).message).not.toContain("C:\\private");
    }
  });
});
