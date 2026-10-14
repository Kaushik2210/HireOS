import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated accessibility checks (axe, WCAG 2.0/2.1 A and AA) on every main page, in demo mode.
// Automated rules find roughly a third of real problems: keyboard use, focus order and screen
// reader wording still need a person. What they do catch is checked on every run.

const PAGES = [
  "/dashboard",
  "/profile",
  "/resume",
  "/jobs",
  "/matches",
  "/documents",
  "/outreach",
  "/applications",
  "/interviews",
  "/analytics",
  "/gaps",
  "/graph",
  "/settings",
];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

for (const path of PAGES) {
  test(`${path} has no automated accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });
}

test("the sign-in and sign-up pages have none either", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await scan(page), path).toEqual([]);
  }
});
