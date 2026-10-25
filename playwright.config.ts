import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: [
    {
      command: "node tests/e2e/prepare-runtime.mjs && npm run dev:server",
      url: "http://127.0.0.1:3000/api/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CLASSROOM_BUZZER_DATA_DIR: "var/e2e/data",
        CLASSROOM_BUZZER_UPLOAD_DIR: "var/e2e/uploads",
        CLASSROOM_BUZZER_EXPORT_DIR: "var/e2e/exports",
        CLASSROOM_BUZZER_PORT: "3000",
      },
    },
    {
      command: "npm run dev:web",
      url: "http://127.0.0.1:4173",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CLASSROOM_BUZZER_API_TARGET: "http://127.0.0.1:3000",
        CLASSROOM_BUZZER_WEB_HOST: "127.0.0.1",
        CLASSROOM_BUZZER_WEB_PORT: "4173",
      },
    },
  ],
});
