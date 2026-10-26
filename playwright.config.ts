import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks of the main flows. By default they start the production build on port 3100 against a
 * separate database (E2E_DATABASE_URL) that is rebuilt and seeded with demo data on every run, so the
 * checks always start from the same state. Run `npm run build` first.
 * Set BASE_URL to point them at an already running copy instead.
 */
const PORT = 3100;
const external = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "", APP_URL: `http://localhost:${PORT}` } as Record<string, string>,
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /.*\.phone\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /.*\.phone\.spec\.ts/ },
  ],
});
