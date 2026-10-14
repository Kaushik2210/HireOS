import { defineConfig, devices } from "@playwright/test";

const DEMO = "http://localhost:3100";
const AUTH = "http://localhost:3101";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry is reported as "flaky", never hidden: it keeps one slow moment on a shared
  // server from failing the run, while a test that needs it still shows up in the summary.
  retries: 1,
  // Every worker hits the same production server, which also parses uploaded PDFs inside the
  // request. Four workers keep the slowest of those inside the wait time on a laptop.
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Workers share one production server; navigation can take a few seconds under that load.
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
