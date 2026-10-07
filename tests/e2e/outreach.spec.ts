import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox (Asha by default).

async function openOutreach(page: Page) {
  await page.goto("/jobs?q=Helix+Backend");
  await page
    .getByRole("link", { name: /Backend Engineer/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
  await page.getByRole("link", { name: "Prepare outreach" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Prepare outreach" })).toBeVisible();
}

async function write(page: Page, kind: string, fill: Record<string, string> = {}) {
  const form = page.getByRole("form", { name: "Write an outreach draft" });
  await form.getByLabel("Kind of message").selectOption({ label: kind });
  for (const [label, value] of Object.entries(fill)) await form.getByLabel(label).fill(value);
  return form;
}

test("states the promise up front: drafts only, nothing connected or sent", async ({ page }) => {
  await openOutreach(page);
  await expect(page.getByText(/never connects to LinkedIn or your email/i)).toBeVisible();
  await expect(page.getByText(/You copy a draft and send it yourself/)).toBeVisible();
});

test("writes a recruiter email from the verified profile and passes the integrity check", async ({
  page,
}) => {
  await openOutreach(page);
  const form = await write(page, "Recruiter email", { "Their name (optional)": "Priya" });
  await form.getByRole("button", { name: "Write draft" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Recruiter email" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue(
    /Interested in the Backend Engineer role at Helix Ledger/,
  );
  const body = page.getByLabel("Message", { exact: true });
  await expect(body).toHaveValue(/Dear Priya,/);
  await expect(body).toHaveValue(/Asha Raman/);
  await expect(body).not.toHaveValue(/Docker/);
  await expect(page.getByTestId("verification")).toContainText("Integrity check passed");
  // The URL carries ids only, never what was typed.
  expect(page.url()).not.toContain("Priya");
});

test("a LinkedIn note stays within 300 characters and is copy-only", async ({ page }) => {
  await openOutreach(page);
  const form = await write(page, "LinkedIn connection note", { "Their name (optional)": "Priya" });
  await form.getByRole("button", { name: "Write draft" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "LinkedIn connection note" }),
  ).toBeVisible();
  const note = page.getByLabel("Note");
  const text = await note.inputValue();
  expect(text.length).toBeLessThanOrEqual(300);
  await expect(page.getByText(/of 300 characters/)).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveCount(0);
  await expect(page.getByText(/never opens, scrapes or automates LinkedIn/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy note" })).toBeVisible();
});

test("only says you applied once you confirm it, and needs context for an alumni note", async ({
  page,
}) => {
  await openOutreach(page);
  const form = await write(page, "Follow-up email");
  await expect(form.getByRole("button", { name: "Write draft" })).toBeDisabled();
  await form.getByLabel("I have already applied for this job.").check();
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    /I applied for the Backend Engineer role/,
  );

  await page.goBack();
  const alumni = await write(page, "Alumni outreach");
  await expect(alumni.getByRole("button", { name: "Write draft" })).toBeDisabled();
  await alumni.getByLabel(/How you know them/).fill("We both studied at Riverside Institute.");
  await alumni.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    /We both studied at Riverside Institute\./,
  );
});

test("an edit that adds a skill the profile lacks is flagged and cannot be approved", async ({
  page,
}) => {
  await openOutreach(page);
  const form = await write(page, "Hiring manager email");
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hiring manager email" })).toBeVisible();

  const body = page.getByLabel("Message", { exact: true });
  await body.fill(`${await body.inputValue()}\n\nI have deep Kubernetes experience.`);
  await page.getByRole("button", { name: "Save changes" }).click();

  const check = page.getByTestId("verification");
  await expect(check).toContainText("Integrity check found 1 problem");
  await expect(check).toContainText("Kubernetes, which is not in your verified profile");
  await expect(page.getByText("Edited by you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve draft" })).toBeDisabled();

  // Taking the claim out clears the problem.
  await body.fill(
    (await body.inputValue()).replace(
      "I have deep Kubernetes experience.",
      "I enjoy building REST APIs.",
    ),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(check).toContainText("Integrity check passed");
  await expect(page.getByRole("button", { name: "Approve draft" })).toBeEnabled();
});

test("moves from draft to approved to sent, and then cannot be edited", async ({ page }) => {
  await openOutreach(page);
  const form = await write(page, "Referral request", {
    "How you know them (optional)": "We met at a campus event.",
  });
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Referral request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I sent this myself" })).toHaveCount(0);

  await page.getByRole("button", { name: "Approve draft" }).click();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  await page.getByRole("button", { name: "I sent this myself" }).click();
  await expect(page.getByText("sent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/You recorded it as sent/)).toBeVisible();
  await expect(page.getByRole("button", { name: "I sent this myself" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("sent", { exact: true }).first()).toBeVisible();
});

test("lists drafts by job, and deletes one", async ({ page }) => {
  await openOutreach(page);
  const form = await write(page, "Recruiter email");
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recruiter email" })).toBeVisible();

  await page.goto("/outreach");
  const groups = page.getByTestId("outreach-groups");
  await expect(groups).toContainText("Backend Engineer");
  await expect(groups).toContainText("Recruiter email");

  await groups.getByRole("link", { name: /Recruiter email/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/outreach$/);
  await expect(page.getByText("No drafts yet")).toBeVisible();
});

test("shows a clear state when nothing is verified", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(page.getByText("Demo data wiped")).toBeVisible();
  await openOutreach(page);
  await expect(page.getByText(/nothing verified to use yet/i)).toBeVisible();
  await expect(page.getByRole("form", { name: "Write an outreach draft" })).toHaveCount(0);
});

test("unknown ids are not found, and another visitor cannot open a draft", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/jobs/00000000-0000-4000-8000-000000000000/outreach");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await openOutreach(page);
  const form = await write(page, "Recruiter email");
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recruiter email" })).toBeVisible();
  const path = new URL(page.url()).pathname;

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${baseURL}${path}`);
  await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await other.close();
});

test("outreach pages do not scroll sideways", async ({ page }) => {
  await openOutreach(page);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  const form = await write(page, "Recruiter email");
  await form.getByRole("button", { name: "Write draft" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Recruiter email" })).toBeVisible();
  expect(await overflow()).toBe(false);
});
