import { mkdir, rm } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

const projectRoot = process.cwd();
const runtimeDirectory = resolve(projectRoot, "var/e2e");
const relativePath = relative(projectRoot, runtimeDirectory);

if (relativePath !== "var\\e2e" && relativePath !== "var/e2e") {
  throw new Error("拒絕清理非預期的 E2E 執行目錄。");
}
if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
  throw new Error("E2E 執行目錄必須位於專案 var/ 之下。");
}

await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
