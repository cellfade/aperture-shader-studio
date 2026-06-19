import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the single studio smoke spec (e2e/smoke.spec.ts).
 *
 * The `webServer` block builds and starts the real app on a fixed port and
 * waits for it before the spec runs, so `npm run test:e2e` is self-contained
 * (no manual server). Set PLAYWRIGHT_BASE_URL to point at an already-running
 * server and the built-in webServer is reused if one is live.
 */
const PORT = 3100;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- --port " + PORT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
