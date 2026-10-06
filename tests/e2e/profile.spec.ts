import { expect, test, type Page } from "@playwright/test";

// Each test gets a fresh browser context, so a fresh isolated demo sandbox seeded with the
// first fictional candidate. Nothing here depends on, or leaks into, another test.

const section = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}`) });

async function openProfile(page: Page) {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Career profile" })).toBeVisible();
}

test("shows the seeded demo candidate, labelled as demo data, with a completeness score", async ({
  page,
}) => {
  await openProfile(page);
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Asha Raman" })).toBeVisible();
  await expect(section(page, "Skills")).toContainText("Python");
  await expect(page.getByRole("progressbar", { name: "Profile completeness" })).toHaveAttribute(
    "aria-valuenow",
    /^\d+$/,
  );
});

test("adds a skill, standardises its name, and keeps it after a reload", async ({ page }) => {
  await openProfile(page);
  await section(page, "Skills").getByRole("button", { name: "Add skill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add skill" });
  await dialog.getByLabel("Skill", { exact: true }).fill("k8s");
  await dialog.getByLabel("Level").selectOption("intermediate");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(section(page, "Skills").getByRole("button", { name: /^Kubernetes/ })).toBeVisible();

  await page.reload();
  await expect(section(page, "Skills").getByRole("button", { name: /^Kubernetes/ })).toBeVisible();
});

test("picks the category automatically for a recognised skill", async ({ page }) => {
  await openProfile(page);
  await section(page, "Skills").getByRole("button", { name: "Add skill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add skill" });
  await dialog.getByLabel("Skill", { exact: true }).fill("MongoDB");
  await dialog.getByLabel("Skill", { exact: true }).blur();
  await expect(dialog.getByLabel("Category")).toHaveValue("database");
});

test("refuses a duplicate skill, matching aliases", async ({ page }) => {
  await openProfile(page);
  await section(page, "Skills").getByRole("button", { name: "Add skill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add skill" });
  await dialog.getByLabel("Skill", { exact: true }).fill("postgres"); // alias of PostgreSQL, already present
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("You already have this skill").first()).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("validates a project on the client and shows accessible errors", async ({ page }) => {
  await openProfile(page);
  await section(page, "Projects").getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add project" });
  await dialog.getByLabel("Repository link").fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(dialog.getByLabel("Project name")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByText("Enter the project name")).toBeVisible();
  await expect(dialog.getByText(/starting with http/i)).toBeVisible();
});

test("adds a project with bullet points and shows them", async ({ page }) => {
  await openProfile(page);
  await section(page, "Projects").getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Add project" });
  await dialog.getByLabel("Project name").fill("Playwright Demo Project");
  await dialog.getByLabel("Technologies").fill("TypeScript, Playwright");
  await dialog.getByLabel("Highlights").fill("Wrote the first bullet\nWrote the second bullet");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const projects = section(page, "Projects");
  await expect(projects.getByRole("heading", { name: "Playwright Demo Project" })).toBeVisible();
  await expect(projects.getByText("Wrote the second bullet")).toBeVisible();
  await expect(projects.getByText("Playwright", { exact: true })).toBeVisible();
});

test("rejects an end date before the start date", async ({ page }) => {
  await openProfile(page);
  await section(page, "Education").getByRole("button", { name: "Add education entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add education entry" });
  await dialog.getByLabel("Institution").fill("Test University");
  await dialog.getByLabel("Degree").fill("BSc");
  await dialog.getByLabel("Start").fill("2024-06");
  await dialog.getByLabel("End").fill("2024-01");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("End date must be after the start date")).toBeVisible();
});

test("edits a skill, then deletes it with a confirmation step", async ({ page }) => {
  await openProfile(page);
  await section(page, "Skills").getByRole("button", { name: /^Git/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit skill" });
  await edit.getByLabel("Level").selectOption("expert");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(
    section(page, "Skills").getByRole("button", { name: /^Git\s*expert/i }),
  ).toBeVisible();

  await section(page, "Skills").getByRole("button", { name: /^Git/ }).click();
  const del = page.getByRole("dialog", { name: "Edit skill" });
  await del.getByRole("button", { name: "Delete" }).click();
  await expect(del.getByRole("button", { name: "Confirm delete" })).toBeVisible();
  await del.getByRole("button", { name: "Confirm delete" }).click();

  await expect(del).toBeHidden();
  await expect(section(page, "Skills").getByRole("button", { name: /^Git/ })).toHaveCount(0);
});

test("closes dialogs with Escape without saving", async ({ page }) => {
  await openProfile(page);
  await section(page, "Skills").getByRole("button", { name: "Add skill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add skill" });
  await dialog.getByLabel("Skill", { exact: true }).fill("Should Not Be Saved");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(section(page, "Skills")).not.toContainText("Should Not Be Saved");
});

test("wiping demo data shows empty states, and a new profile can be built from scratch", async ({
  page,
}) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(page.getByText("Demo data wiped")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Create your profile" })).toBeVisible();
  await expect(page.getByText("No skills added")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Profile completeness" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  await page.getByRole("button", { name: "Create profile" }).click();
  const dialog = page.getByRole("dialog", { name: "Create profile" });
  await dialog.getByLabel("Full name").fill("Test Candidate");
  await dialog.getByLabel("Headline").fill("Writing tests for fun");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { name: "Test Candidate" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Profile completeness" })).not.toHaveAttribute(
    "aria-valuenow",
    "0",
  );
});

test("loads a different demo candidate", async ({ page }) => {
  await openProfile(page);
  await page.getByLabel("Demo candidate").selectOption("meera");
  await page.getByRole("button", { name: "Load candidate" }).click();
  await expect(page.getByRole("heading", { name: "Meera Nair" })).toBeVisible();
  await expect(section(page, "Skills")).toContainText("Docker");
});

test("sets a career goal from the empty state after a wipe", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await page.getByRole("button", { name: "Set goal" }).click();
  const dialog = page.getByRole("dialog", { name: "Set career goal" });
  await dialog.getByLabel("Target roles").fill("Backend Engineer, Data Engineer");
  await dialog.getByLabel("Timeline in months").fill("6");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Data Engineer", { exact: true })).toBeVisible();
  await expect(page.getByText(/within 6 months/)).toBeVisible();
});

test("sandboxes are isolated between visitors", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  const base = test.info().project.use.baseURL!;

  await pageA.goto(`${base}/profile`);
  await pageA.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(pageA.getByRole("heading", { name: "Create your profile" })).toBeVisible();

  await pageB.goto(`${base}/profile`);
  await expect(pageB.getByRole("heading", { name: "Asha Raman" })).toBeVisible();

  await a.close();
  await b.close();
});

test("the dashboard shows live profile completeness with next steps", async ({ page }) => {
  await page.goto("/dashboard");
  const panel = page.getByRole("region", { name: "Profile completeness" });
  await expect(panel.getByRole("progressbar")).toBeVisible();
  await expect(panel.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open profile" })).toBeVisible();
});

test("the profile page does not scroll sideways", async ({ page }) => {
  await openProfile(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the sidebar links to the profile page", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop sidebar");
  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Career Profile" })
    .click();
  await expect(page).toHaveURL(/\/profile$/);
});
