import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks of the main flows. They expect the app running on BASE_URL with the demo seed
 * (npm run db:seed) and SMS_PROVIDER=console, so the OTP is readable on screen.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /.*\.phone\.spec\.ts/ },
  ],
});
