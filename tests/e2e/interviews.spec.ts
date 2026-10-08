import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox, which starts with
// five sample applications (and no interviews or practice yet).

const GOOD =
  "At my internship at Brightleaf Software our reporting query was slow, which was a problem for the team. My task was to make it fast enough for daily use. I profiled it, added two indexes and rewrote the join in PostgreSQL, and I tested the change against 40,000 rows. As a result the report time dropped from 4 seconds to 600 ms, and I learned to measure before optimising.";

async function openApplication(page: Page, title: string) {
  await page.goto("/applications");
  await page
    .getByTestId("application-card")
    .filter({ hasText: title })
    .getByRole("link", { name: new RegExp(title) })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function addInterview(page: Page, label = "Phone screen") {
  await openApplication(page, "Python Developer Intern");
  await page.getByText("Add an interview").click();
  const form = page.getByRole("form", { name: "Add an interview" });
  await form.getByLabel("Round name").fill(label);
  await form.getByLabel("Format").selectOption({ label: "Video call" });
  await form.getByLabel("Date (optional)").fill("2030-02-10");
  await form.getByLabel("Time (optional)").fill("14:30");
  await form.getByLabel("Interviewer (optional)").fill("Priya");
  await form.getByRole("button", { name: "Add interview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}

async function openJobPractice(page: Page) {
  await page.goto("/jobs?q=Helix+Backend");
  await page
    .getByRole("link", { name: /Backend Engineer/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Practice interview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Practice interview" })).toBeVisible();
}

async function startSession(page: Page, focus: string, count = "3") {
  const form = page.getByRole("form", { name: "Start a practice session" });
  await form.getByLabel("Practise").selectOption({ label: focus });
  await form.getByLabel("Questions").selectOption(count);
  await form.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByTestId("current-question")).toBeVisible();
}

async function answer(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Your answer" });
  const submit = page.getByRole("button", { name: /Submit/ });
  // Typing before the page has hydrated is lost, so retry until the button reflects the text.
  await expect(async () => {
    await box.fill(text);
    await expect(submit).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await submit.click();
}

test.describe("interview rounds", () => {
  test("records a round, writes a checklist from the posting, and shows it in the hub", async ({
    page,
  }) => {
    await addInterview(page);
    await expect(page.getByText("Phone screen", { exact: true }).first()).toBeVisible();
    const list = page.getByTestId("checklist");
    await expect(list).toContainText(
      "Re-read the posting for Python Developer Intern at Aurora Freight Tech",
    );
    await expect(list).toContainText("Test your camera, microphone and the meeting link");
    await expect(page.getByTestId("checklist-progress")).toHaveText(/^0 of \d+ done$/);

    await page.goto("/interviews");
    const rounds = page.getByTestId("interview-list");
    await expect(rounds).toContainText("Phone screen · Python Developer Intern");
    await expect(rounds).toContainText("2030-02-10 at 14:30");
  });

  test("ticks items, adds and removes your own, and refreshes suggestions without losing progress", async ({
    page,
  }) => {
    await addInterview(page);
    const first = page.getByTestId("checklist").getByRole("checkbox").first();
    await first.click();
    await expect(first).toBeChecked();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/^1 of \d+ done$/);

    await page.getByLabel("New checklist item").fill("Buy a notebook");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("checklist")).toContainText("Buy a notebook");

    await page.getByRole("button", { name: "Refresh suggestions" }).click();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/^1 of \d+ done$/);
    await expect(page.getByTestId("checklist")).toContainText("Buy a notebook");

    // Suggested items cannot be removed; your own can.
    await expect(page.getByRole("button", { name: /^Remove: Re-read/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove: Buy a notebook" }).click();
    await expect(page.getByTestId("checklist")).not.toContainText("Buy a notebook");

    await page.reload();
    await expect(page.getByTestId("checklist-progress")).toHaveText(/^1 of \d+ done$/);
  });

  test("edits the details and marks the round completed", async ({ page }) => {
    await addInterview(page);
    const form = page.getByRole("form", { name: "Interview details" });
    await form.getByLabel("Notes (optional)").fill("They asked about my SQL work.");
    await form.getByLabel("Status").selectOption({ label: "Completed" });
    await form.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.goto("/interviews");
    await expect(page.getByText("Past and cancelled")).toBeVisible();
    await expect(page.getByTestId("interview-list")).toContainText("Phone screen");
  });

  test("deletes a round with a confirmation", async ({ page }) => {
    await addInterview(page);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page).toHaveURL(/\/interviews$/);
    await expect(page.getByText("No interviews recorded yet")).toBeVisible();
  });

  test("a round goes with its application", async ({ page }) => {
    await addInterview(page);
    await openApplication(page, "Python Developer Intern");
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await page.goto("/interviews");
    await expect(page.getByText("No interviews recorded yet")).toBeVisible();
  });
});

test.describe("mock interview", () => {
  test("shows what is worth preparing, flags a skill the profile lacks, and offers the hub shortcut", async ({
    page,
  }) => {
    await page.goto("/interviews");
    await expect(page.getByTestId("practice-targets")).toContainText(
      "Backend Engineer, Helix Ledger",
    );
    await openJobPractice(page);
    const likely = page.getByTestId("likely-questions");
    await expect(likely.locator("li")).toHaveCount(8);
    await expect(likely).toContainText(
      "The posting asks for Docker and your verified profile does not show it",
    );
    await expect(page.getByText(/An AI coach is Planned/)).toBeVisible();
  });

  test("runs a session one question at a time, with feedback on six measures after each answer", async ({
    page,
  }) => {
    await openJobPractice(page);
    await startSession(page, "Behavioral");
    await expect(page.getByTestId("current-question")).toContainText("Question 1 of 3");

    await answer(page, GOOD);
    await expect(page.getByTestId("current-question")).toContainText("Question 2 of 3");
    const first = page.getByTestId("answers").locator("> li").first();
    await expect(first.getByTestId("feedback")).toBeVisible();
    for (const d of ["structure", "specificity", "relevance", "evidence", "clarity", "integrity"]) {
      await expect(first.getByTestId(`dimension-${d}`)).toBeVisible();
    }
    await expect(first.getByTestId("answer-score")).toHaveText(/^\d+$/);
    await expect(
      first.getByText(/cannot tell whether a technical answer is correct/),
    ).toBeVisible();

    await answer(page, GOOD);
    await answer(page, GOOD);

    await expect(page.getByRole("heading", { level: 1, name: "Practice results" })).toBeVisible();
    await expect(page.getByTestId("session-score")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("dimension-averages").locator("li")).toHaveCount(6);
    await expect(page.getByTestId("answers").locator("> li")).toHaveCount(3);
  });

  test("a well-built answer scores higher than a vague one", async ({ page }) => {
    await openJobPractice(page);
    await startSession(page, "Behavioral");
    await answer(page, "I did stuff and things worked out basically. It was fine.");
    await answer(page, GOOD);
    await answer(page, GOOD);
    const scores = await page.getByTestId("answer-score").allTextContents();
    expect(Number(scores[1])).toBeGreaterThan(Number(scores[0]) + 25);
  });

  test("flags a skill claimed but missing from the profile, and does not take an honest 'not yet' as a bluff", async ({
    page,
  }) => {
    await openJobPractice(page);
    await startSession(page, "Technical", "5");
    await answer(page, "I have used Kubernetes in production for years and it is great.");
    const integrity = page
      .getByTestId("answers")
      .locator("li")
      .first()
      .getByTestId("dimension-integrity");
    await expect(integrity).toContainText("Kubernetes");
    await expect(integrity).toContainText("not in your verified profile");
    await expect(page.getByTestId("improve").first()).toContainText("add it to your profile first");
  });

  test("rejects an empty answer and keeps the question", async ({ page }) => {
    await openJobPractice(page);
    await startSession(page, "Behavioral");
    await expect(page.getByRole("button", { name: /Submit/ })).toBeDisabled();
    await page.getByRole("textbox", { name: "Your answer" }).fill("   ");
    await expect(page.getByRole("button", { name: /Submit/ })).toBeDisabled();
    await expect(page.getByTestId("current-question")).toContainText("Question 1 of 3");
  });

  test("keeps a history, shows an unfinished session as in progress, and practises different questions the second time", async ({
    page,
  }) => {
    await openJobPractice(page);
    await startSession(page, "Behavioral");
    const first = await page.getByRole("heading", { level: 2 }).first().innerText();
    await page.goto("/interviews");
    await expect(page.getByTestId("practice-history")).toContainText("In progress");

    await openJobPractice(page);
    await expect(page.getByTestId("job-sessions").locator("li")).toHaveCount(1);
    await startSession(page, "Behavioral");
    const second = await page.getByRole("heading", { level: 2 }).first().innerText();
    expect(second).not.toBe(first);
  });

  test("deletes a session", async ({ page }) => {
    await openJobPractice(page);
    await startSession(page, "Behavioral");
    await page.getByRole("button", { name: "Delete session" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page).toHaveURL(/\/interviews$/);
    await expect(page.getByText("No practice sessions yet.")).toBeVisible();
  });
});

test("unknown ids are not found, and another visitor cannot open a session or round", async ({
  page,
  browser,
  baseURL,
}) => {
  for (const path of [
    "/interviews/00000000-0000-4000-8000-000000000000",
    "/interviews/not-a-uuid",
    "/practice/00000000-0000-4000-8000-000000000000",
    "/jobs/00000000-0000-4000-8000-000000000000/practice",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
  await openJobPractice(page);
  await startSession(page, "Behavioral");
  const sessionPath = new URL(page.url()).pathname;
  await addInterview(page);
  const roundPath = new URL(page.url()).pathname;
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  for (const path of [sessionPath, roundPath]) {
    await otherPage.goto(`${baseURL}${path}`);
    await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
  await other.close();
});

test("the interview pages do not scroll sideways", async ({ page }) => {
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  await page.goto("/interviews");
  expect(await overflow()).toBe(false);
  await addInterview(page);
  expect(await overflow()).toBe(false);
  await openJobPractice(page);
  expect(await overflow()).toBe(false);
  await startSession(page, "Behavioral");
  await answer(page, GOOD);
  await expect(page.getByTestId("feedback")).toBeVisible();
  expect(await overflow()).toBe(false);
});
