import { defineConfig, devices } from "@playwright/test";

const DEMO = "http://localhost:3100";
const AUTH = "http://localhost:3101";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Eight workers share one production server; navigation can take a few seconds under that load.
  expect: { timeout: 10_000 },
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      testIgnore: /auth-enabled/,
      use: { ...devices["Desktop Chrome"], baseURL: DEMO },
    },
    {
      name: "mobile",
      testIgnore: /auth-enabled/,
      use: { ...devices["Pixel 7"], baseURL: DEMO },
    },
    {
      name: "auth-enabled",
      testMatch: /auth-enabled/,
      use: { ...devices["Desktop Chrome"], baseURL: AUTH },
    },
  ],
  webServer: {
    // Production build, closer to what ships than the dev server.
    command: "node scripts/e2e-servers.mjs",
    url: DEMO,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
  },
});
