import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export interface RuntimePaths {
  data: string;
  uploads: string;
  exports: string;
}

export class RuntimeConfigurationError extends Error {
  readonly code = "RUNTIME_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

function resolveDirectory(
  environment: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
  baseDirectory: string,
): string {
  const configured = Object.hasOwn(environment, key)
    ? environment[key]
    : fallback;

  if (!configured?.trim()) {
    throw new RuntimeConfigurationError(`必要的目錄設定 ${key} 不可為空白。`);
  }

  return resolve(baseDirectory, configured);
}

export function resolveRuntimePaths(
  environment: NodeJS.ProcessEnv = process.env,
  baseDirectory = projectRoot,
): RuntimePaths {
  return {
    data: resolveDirectory(
      environment,
      "CLASSROOM_BUZZER_DATA_DIR",
      "var/data",
      baseDirectory,
    ),
    uploads: resolveDirectory(
      environment,
      "CLASSROOM_BUZZER_UPLOAD_DIR",
      "var/uploads",
      baseDirectory,
    ),
    exports: resolveDirectory(
      environment,
      "CLASSROOM_BUZZER_EXPORT_DIR",
      "var/exports",
      baseDirectory,
    ),
  };
}

export async function ensureRuntimeDirectories(paths: RuntimePaths): Promise<void> {
  try {
    await Promise.all(
      Object.values(paths).map((directory) => mkdir(directory, { recursive: true })),
    );
  } catch {
    throw new RuntimeConfigurationError("無法準備系統執行目錄，請檢查目錄權限。");
  }
}
