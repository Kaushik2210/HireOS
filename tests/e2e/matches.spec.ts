import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox (Asha by default).

const strength = async (page: Page) =>
  Number(await page.getByTestId("strength-value").evaluate((el) => el.childNodes[0]!.textContent));

async function openHelixBackend(page: Page) {
  await page.goto("/jobs?q=Helix+Backend");
  await page
    .getByRole("link", { name: /Backend Engineer/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Job Intelligence" })).toBeVisible();
}

test("ranks every job for the demo candidate, best first, labelled as demo data", async ({
  page,
}) => {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true }).first()).toBeVisible();
  const items = page.getByTestId("match-list").locator("> li");
  await expect(items).toHaveCount(20);
  const values = await items.evaluateAll((els) =>
    els.map((el) => Number(/Application Strength\s*(\d+)/.exec(el.textContent ?? "")?.[1])),
  );
  expect(values.every((v) => Number.isInteger(v))).toBe(true);
  expect([...values].sort((a, b) => b - a)).toEqual(values);
});

test("filters by band and pages through results", async ({ page }) => {
  await page.goto("/matches");
  await page.getByRole("link", { name: /^Strong/ }).click();
  await expect(page).toHaveURL(/label=strong/);
  const chips = page.getByTestId("match-list").getByText(/· Strong/);
  expect(await chips.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("match-list").getByText(/· (Good|Stretch|Low)/)).toHaveCount(0);

  await page.goto("/matches");
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
});

test("explains a match: breakdown with inputs, why, gaps and keywords", async ({ page }) => {
  await openHelixBackend(page);
  expect(await strength(page)).toBeGreaterThan(0);
  for (const id of [
    "skills",
    "projects",
    "experience",
    "keywords",
    "education",
    "location",
    "seniority",
  ]) {
    await expect(page.getByTestId(`component-${id}`)).toBeVisible();
  }
  await page.getByTestId("component-skills").getByText("Inputs used").click();
  await expect(page.getByTestId("component-skills").locator("dl")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why you match" })).toBeVisible();
  await expect(page.getByTestId("recommended-action")).not.toBeEmpty();
  await expect(page.getByText(/not a prediction/i)).toBeVisible();
});

test("names a missing required skill, and confirming it on the profile removes the gap", async ({
  page,
}) => {
  await openHelixBackend(page);
  const gap = page
    .getByTestId("gaps")
    .getByText("Docker is required by this job but was not found in your verified profile");
  await expect(gap).toBeVisible();
  const before = await strength(page);
  const jobUrl = page.url();

  await page.goto("/profile");
  await page
    .getByRole("region", { name: /^Skills/ })
    .getByRole("button", { name: "Add skill" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add skill" });
  await dialog.getByLabel("Skill", { exact: true }).fill("Docker");
  await dialog.getByLabel("Level").selectOption("intermediate");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.goto(jobUrl);
  await expect(page.getByRole("heading", { name: "Job Intelligence" })).toBeVisible();
  await expect(page.getByTestId("gaps").getByText(/^Docker is required/)).toHaveCount(0);
  expect(await strength(page)).toBeGreaterThan(before);
});

test("a wiped profile asks for verified data instead of showing a score", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(page.getByText("Demo data wiped")).toBeVisible();

  await page.goto("/matches");
  await expect(page.getByText(/nothing verified to use yet/i)).toBeVisible();
  await expect(page.getByTestId("match-list")).toHaveCount(0);

  await page.goto("/jobs");
  await expect(page.getByText(/· (Strong|Good|Stretch|Low)/)).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Top opportunities" })).toContainText(
    "Nothing to rank yet",
  );
});

test("a different demo candidate gets a different ranking", async ({ page }) => {
  const topTitle = async () => {
    await page.goto("/matches");
    return page.getByTestId("match-list").locator("> li").first().getByRole("heading").innerText();
  };
  const asha = await topTitle();
  await page.goto("/profile");
  await page.getByLabel("Demo candidate").selectOption("rohan");
  await page.getByRole("button", { name: "Load candidate" }).click();
  await expect(page.getByRole("heading", { name: "Rohan" })).toBeVisible();
  expect(await topTitle()).not.toBe(asha);
});

test("the dashboard shows the top three with skill match and missing skills", async ({ page }) => {
  await page.goto("/dashboard");
  const panel = page.getByRole("region", { name: "Top opportunities" });
  await expect(panel.getByTestId("top-opportunities").locator("> li")).toHaveCount(3);
  await expect(panel.getByText(/Skill match: \d+ of \d+ required/).first()).toBeVisible();
});

test("job cards show a strength chip", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByText(/· (Strong|Good|Stretch|Low)/).first()).toBeVisible();
});

test("matches page does not overflow horizontally", async ({ page }) => {
  await page.goto("/matches");
  await expect(page.getByTestId("match-list")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
