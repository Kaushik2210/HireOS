import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox, which starts with
// five sample applications.

const column = (page: Page, status: string) => page.getByTestId(`column-${status}`);
const card = (page: Page, title: string) =>
  page.getByTestId("application-card").filter({ hasText: title });

async function openBoard(page: Page) {
  await page.goto("/applications");
  await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
}

async function openApplication(page: Page, title: string) {
  await openBoard(page);
  await card(page, title)
    .getByRole("link", { name: new RegExp(title) })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("shows the sample pipeline across its stages, labelled as demo data", async ({ page }) => {
  await openBoard(page);
  await expect(page.getByText("Demo data", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("application-card")).toHaveCount(5);
  await expect(column(page, "interview")).toContainText("Python Developer Intern");
  await expect(column(page, "applied")).toContainText("Backend Engineer");
  await expect(column(page, "shortlisted")).toContainText("Data Engineering Intern");
  await expect(column(page, "rejected")).toContainText("Full-Stack Developer");
  await expect(column(page, "discovered")).toContainText("Junior Data Analyst");
  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("Tracked");
  await expect(summary).toContainText("5");
});

test("flags the application that has been quiet for over a week", async ({ page }) => {
  await openBoard(page);
  await expect(page.getByTestId("follow-up-flag")).toHaveCount(1);
  await expect(card(page, "Backend Engineer")).toContainText(/Follow-up due: quiet for \d+ days/);
  await expect(page.getByTestId("summary")).toContainText("Follow-ups due");
});

test("offers only the moves the pipeline allows, and moves a card", async ({ page }) => {
  await openBoard(page);
  const select = page.getByLabel("Move Data Engineering Intern to");
  const options = await select.locator("option").allTextContents();
  expect(options).toEqual(["Move to...", "Discovered", "Preparing", "Applied", "Withdrawn"]);
  await select.selectOption({ label: "Preparing" });
  await expect(column(page, "preparing")).toContainText("Data Engineering Intern");
  await expect(column(page, "shortlisted")).not.toContainText("Data Engineering Intern");
  // A closed application offers no moves at all.
  await expect(page.getByLabel("Move Full-Stack Developer to")).toHaveCount(0);
});

test("records a move with a note on the timeline, and keeps the history", async ({ page }) => {
  await openApplication(page, "Backend Engineer");
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toContainText("Moved from Preparing to Applied.");

  const form = page.getByRole("form", { name: "Change status" });
  await form.getByLabel("Move to").selectOption({ label: "Interview" });
  await form.getByLabel("Note (optional)").fill("Recruiter called to set up a screen.");
  await form.getByRole("button", { name: "Move" }).click();

  await expect(page.getByText("Interview", { exact: true }).first()).toBeVisible();
  await expect(timeline).toContainText("Moved from Applied to Interview.");
  await expect(timeline).toContainText("Recruiter called to set up a screen.");
  // The earlier history is still there, newest first.
  await expect(timeline.locator("li").first()).toContainText("Moved from Applied to Interview.");
  await expect(timeline).toContainText("Added to your pipeline as Discovered.");
});

test("a closed application is final", async ({ page }) => {
  await openApplication(page, "Full-Stack Developer");
  await expect(page.getByText("Rejected is final")).toBeVisible();
  await expect(page.getByRole("form", { name: "Change status" })).toHaveCount(0);
});

test("a due follow-up leads to a drafted message and clears once recorded", async ({ page }) => {
  await openApplication(page, "Backend Engineer");
  const panel = page.getByTestId("follow-up-panel");
  await expect(panel).toContainText("A follow-up is due");
  await expect(panel).toContainText("HireOS drafts the message; you send it yourself.");

  // The draft starts on the follow-up kind, and still needs the person to confirm they applied.
  await panel.getByRole("link", { name: "Draft a follow-up" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Prepare outreach" })).toBeVisible();
  await expect(page.getByLabel("Kind of message")).toHaveValue("follow_up");
  await expect(page.getByRole("button", { name: "Write draft" })).toBeDisabled();

  await page.goBack();
  await panel.getByRole("button", { name: "I followed up" }).click();
  await expect(page.getByTestId("follow-up-panel")).toHaveCount(0);
  await expect(page.getByTestId("timeline")).toContainText("You recorded that you followed up.");

  await openBoard(page);
  await expect(page.getByTestId("follow-up-flag")).toHaveCount(0);
});

test("saves notes and a follow-up date, and keeps them after a reload", async ({ page }) => {
  await openApplication(page, "Data Engineering Intern");
  const form = page.getByRole("form", { name: "Application details" });
  await form.getByLabel("Notes").fill("Asked about the stack in the intro call.");
  await form.getByLabel("Follow up on").fill("2030-01-15");
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByTestId("timeline")).toContainText(
    "You set a follow-up date for 2030-01-15.",
  );

  await page.reload();
  const reloaded = page.getByRole("form", { name: "Application details" });
  await expect(reloaded.getByLabel("Notes")).toHaveValue(
    "Asked about the stack in the intro call.",
  );
  await expect(reloaded.getByLabel("Follow up on")).toHaveValue("2030-01-15");
});

test("adds a note to the timeline", async ({ page }) => {
  await openApplication(page, "Junior Data Analyst");
  await page.getByLabel("Add to the timeline").fill("Looks like a good fit for my SQL work.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByTestId("timeline")).toContainText("You added a note.");
  await expect(page.getByTestId("timeline")).toContainText(
    "Looks like a good fit for my SQL work.",
  );
});

test("tracks a job from its page, shows where it stands, and refuses a duplicate", async ({
  page,
}) => {
  await page.goto("/jobs?q=Platform+Engineer");
  await page
    .getByRole("link", { name: /^Platform Engineer/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Platform Engineer" })).toBeVisible();

  const form = page.getByRole("form", { name: "Add to your pipeline" });
  await form.getByLabel("Track as").selectOption({ label: "Applied" });
  await form.getByLabel("Applied on (optional)").fill("2026-10-01");
  await form.getByRole("button", { name: "Add to pipeline" }).click();

  const status = page.getByTestId("pipeline-status");
  await expect(status).toContainText("In your pipeline:");
  await expect(status).toContainText("Applied");
  await expect(page.getByRole("form", { name: "Add to your pipeline" })).toHaveCount(0);

  await status.getByRole("link", { name: "Open the application" }).click();
  await expect(page.getByText("You applied on 2026-10-01")).toBeVisible();
  await expect(page.getByTestId("timeline")).toContainText("Added to your pipeline as Applied.");
});

test("links a saved resume to the application", async ({ page }) => {
  await page.goto("/jobs?q=Helix+Backend");
  await page
    .getByRole("link", { name: /Backend Engineer/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Tailor resume" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Resume version 1/ })).toBeVisible();

  await openApplication(page, "Backend Engineer");
  const form = page.getByRole("form", { name: "Application details" });
  await form.getByLabel("Resume used").selectOption({ label: "Version 1 (draft)" });
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("timeline")).toContainText("You changed the documents linked");
  await page.reload();
  await expect(page.getByLabel("Resume used")).toHaveValue(/.+/);
});

test("clears the sample applications and keeps the ones you added", async ({ page }) => {
  await page.goto("/jobs?q=Platform+Engineer");
  await page
    .getByRole("link", { name: /^Platform Engineer/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to pipeline" }).click();
  await expect(page.getByTestId("pipeline-status")).toContainText("In your pipeline:");

  await openBoard(page);
  await expect(page.getByTestId("application-card")).toHaveCount(6);
  await page.getByRole("button", { name: "Clear sample applications" }).click();
  await expect(page.getByTestId("application-card")).toHaveCount(1);
  await expect(page.getByText("Sample applications", { exact: true })).toHaveCount(0);
  await expect(card(page, "Platform Engineer")).toBeVisible();
});

test("shows an empty state after everything is removed, and deletes with a confirmation", async ({
  page,
}) => {
  await openApplication(page, "Junior Data Analyst");
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByTestId("application-card")).toHaveCount(4);

  await page.getByRole("button", { name: "Clear sample applications" }).click();
  await expect(page.getByText("No applications yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Find a job to track" })).toBeVisible();
});

test("the dashboard shows the pipeline and what needs doing today", async ({ page }) => {
  await page.goto("/dashboard");
  const pipeline = page.getByRole("region", { name: "Pipeline summary" });
  await expect(pipeline.getByTestId("pipeline-total")).toHaveText("5");
  await expect(pipeline.getByTestId("pipeline-counts")).toContainText("Interview");
  const today = page.getByRole("region", { name: "Today's actions" });
  await expect(today.getByTestId("due-follow-ups")).toContainText("Backend Engineer");
  await expect(today.getByTestId("untracked-matches")).toBeVisible();
});

test("unknown ids are not found, and another visitor cannot open an application", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/applications/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("/applications/not-a-uuid");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

  await openApplication(page, "Backend Engineer");
  const path = new URL(page.url()).pathname;
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${baseURL}${path}`);
  await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await other.close();
});

test("the board scrolls inside itself and the page does not scroll sideways", async ({ page }) => {
  await openBoard(page);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  await expect(page.getByRole("region", { name: "Pipeline board" })).toBeVisible();
  await openApplication(page, "Backend Engineer");
  expect(await overflow()).toBe(false);
});
