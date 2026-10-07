import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox (Asha by default).

async function openHelixJob(page: Page) {
  await page.goto("/jobs?q=Helix+Backend");
  await page
    .getByRole("link", { name: /Backend Engineer/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
}

async function openTailor(page: Page) {
  await openHelixJob(page);
  await page.getByRole("link", { name: "Tailor resume" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tailor your resume" })).toBeVisible();
}

async function saveResume(page: Page) {
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Resume version \d+/ })).toBeVisible();
}

test("previews a tailored resume with reasons, the missing skills, and a passing integrity check", async ({
  page,
}) => {
  await openTailor(page);
  const preview = page.getByTestId("resume-preview");
  await expect(preview).toContainText("Asha Raman");
  await expect(preview.getByTestId("resume-skills")).toContainText("Python");

  await expect(page.getByTestId("verification")).toContainText("Integrity check passed");
  await expect(page.getByTestId("changes")).toBeVisible();
  await expect(page.getByTestId("changes")).toContainText(/which this job asks for|requires/);

  const missing = page.getByTestId("missing");
  await expect(missing).toContainText(
    "Docker is required by this job but was not found in your verified profile. If you have genuinely used it, add the experience.",
  );
  // Never added to the resume.
  await expect(preview).not.toContainText("Docker");
  await expect(page.getByText(/Rewriting wording with an AI model is Planned/)).toBeVisible();
});

test("leaves out a chosen project, saves a draft, approves it, and keeps it after a reload", async ({
  page,
}) => {
  await openTailor(page);
  const picker = page.getByRole("form", { name: "Choose what to include" });
  const projectBox = picker.getByRole("checkbox", { name: /Campus Placement Tracker/ });
  await expect(page.getByTestId("resume-preview")).toContainText("Campus Placement Tracker");
  await projectBox.uncheck();
  await picker.getByRole("button", { name: "Update preview" }).click();
  await expect(page).toHaveURL(/f=1/);
  await expect(page.getByTestId("resume-preview")).not.toContainText("Campus Placement Tracker");
  await expect(page.getByTestId("changes")).toContainText("You left this out");

  await saveResume(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Resume version 1");
  await expect(page.getByText("draft", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("resume-preview")).not.toContainText("Campus Placement Tracker");

  await page.getByRole("button", { name: "Approve this version" }).click();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve this version" })).toHaveCount(0);
  await expect(page.getByText(/Approved versions never change/)).toBeVisible();

  await page.reload();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();
});

test("compares two versions line by line", async ({ page }) => {
  await openTailor(page);
  await saveResume(page);

  await page.goBack();
  const picker = page.getByRole("form", { name: "Choose what to include" });
  await picker.getByRole("checkbox", { name: /Expense Splitter API/ }).uncheck();
  await picker.getByRole("button", { name: "Update preview" }).click();
  await expect(page).toHaveURL(/f=1/);
  await saveResume(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Resume version 2");

  await page.getByLabel("Compare with").selectOption({ label: "Version 1 (draft)" });
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const diff = page.getByTestId("diff");
  await expect(diff).toBeVisible();
  await expect(page.getByRole("heading", { name: /Version 1 to version 2/ })).toContainText(
    /\d+ added, \d+ removed/,
  );
  await expect(diff).toContainText("Expense Splitter API");
});

test("downloads the version as plain text", async ({ page }) => {
  await openTailor(page);
  await saveResume(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Resume-.*-v1\.txt$/);
});

test("drafts a cover letter that names only skills the profile has, and flags an edit that adds one", async ({
  page,
}) => {
  await openHelixJob(page);
  await page.getByRole("link", { name: "Cover letter" }).click();
  const editor = page.getByLabel("Your letter");
  await expect(editor).toHaveValue(
    /I am writing to apply for the Backend Engineer role at Helix Ledger\./,
  );
  await expect(editor).not.toHaveValue(/Docker/);

  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Cover letter version 1" }),
  ).toBeVisible();
  await expect(page.getByTestId("verification")).toContainText("Integrity check passed");
  await expect(page.getByTestId("letter-text")).toContainText("Asha Raman");

  await page.getByRole("link", { name: "Edit as a new version" }).click();
  const edit = page.getByLabel("Your letter");
  await edit.fill(`${await edit.inputValue()}\n\nI have deep Kubernetes experience.`);
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Cover letter version 2" }),
  ).toBeVisible();
  await expect(page.getByText("Edited by you")).toBeVisible();
  const check = page.getByTestId("verification");
  await expect(check).toContainText("Integrity check found 1 problem");
  await expect(check).toContainText("Kubernetes, which is not in your verified profile");
  await expect(page.getByRole("button", { name: "Approve this version" })).toBeDisabled();
});

test("lists saved documents by job, and deletes one", async ({ page }) => {
  await openTailor(page);
  await saveResume(page);
  await page.goto("/documents");
  await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  const groups = page.getByTestId("document-groups");
  await expect(groups).toContainText("Backend Engineer");
  await expect(groups).toContainText("Resume version 1");

  await groups.getByRole("link", { name: "Resume version 1" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

  await page.goto("/documents");
  await expect(page.getByText("No saved documents yet")).toBeVisible();
});

test("shows a clear state when nothing is verified", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(page.getByText("Demo data wiped")).toBeVisible();
  await openTailor(page);
  await expect(page.getByText(/nothing verified to use yet/i)).toBeVisible();
  await expect(page.getByTestId("resume-preview")).toHaveCount(0);
});

test("unknown and malformed ids are not found", async ({ page }) => {
  await page.goto("/jobs/00000000-0000-4000-8000-000000000000/tailor");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.goto("/jobs/not-a-uuid/cover-letter");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await openHelixJob(page);
  const jobUrl = page.url();
  await page.goto(`${jobUrl}/documents/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("a version cannot be opened from another visitor's sandbox", async ({
  page,
  browser,
  baseURL,
}) => {
  await openTailor(page);
  await saveResume(page);
  const url = page.url();
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${baseURL}${new URL(url).pathname}`);
  await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await other.close();
});

test("tailoring pages do not scroll sideways", async ({ page }) => {
  await openTailor(page);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  await saveResume(page);
  expect(await overflow()).toBe(false);
});
