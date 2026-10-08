import { expect, test, type Page } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox, which starts with
// five sample applications: three applied (one in interview, one rejected, one waiting), one
// shortlisted and one discovered.

async function trackAsApplied(page: Page, query: string, title: RegExp) {
  await page.goto(`/jobs?q=${encodeURIComponent(query)}`);
  await page.getByRole("link", { name: title }).first().click();
  const form = page.getByRole("form", { name: "Add to your pipeline" });
  await form.getByLabel("Track as").selectOption({ label: "Applied" });
  await form.getByRole("button", { name: "Add to pipeline" }).click();
  await expect(page.getByTestId("pipeline-status")).toContainText("In your pipeline:");
}

test.describe("analytics", () => {
  test("shows the funnel from the sample applications, labelled as sample data", async ({
    page,
  }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
    await expect(page.getByText("Includes sample data")).toBeVisible();

    await expect(page.getByTestId("rate-applied")).toContainText("3");
    await expect(page.getByTestId("rate-heard-back")).toContainText("2 of 3");
    await expect(page.getByTestId("rate-interviews")).toContainText("1 of 3");
    await expect(page.getByTestId("rate-interviews")).toContainText(
      "Small sample: read with care.",
    );
    await expect(page.getByTestId("funnel").locator("> li")).toHaveCount(5);
    await expect(page.getByTestId("timing")).toContainText("typical wait for a first reply");
    await expect(page.getByTestId("weekly").locator("> li")).toHaveCount(8);
  });

  test("says there is not enough data yet and shows only what it can", async ({ page }) => {
    await page.goto("/analytics");
    const insights = page.getByTestId("insights");
    await expect(insights.getByTestId("insights-headline")).toHaveText(
      "Not enough applications yet",
    );
    await expect(insights).toContainText("at least 5 applications");
    await expect(insights).toContainText("you have 3");
    await expect(page.getByTestId("findings")).toHaveCount(0);
  });

  test("with enough applications it gives hedged findings with their evidence", async ({
    page,
  }) => {
    // Three more applications to jobs that are a stretch on paper bring the total to six.
    await trackAsApplied(page, "Senior Platform", /Senior Platform Engineer/);
    await trackAsApplied(page, "Senior Backend", /Senior Backend Engineer/);
    await trackAsApplied(page, "Data Scientist", /Data Scientist/);

    await page.goto("/analytics");
    const insights = page.getByTestId("insights");
    await expect(insights.getByTestId("insights-headline")).not.toHaveText(
      "Not enough applications yet",
    );
    const findings = page.getByTestId("findings");
    await expect(findings).toBeVisible();
    expect(await findings.locator("> li").count()).toBeGreaterThanOrEqual(1);

    // Every finding is hedged and can show what it is based on.
    const text = await findings.innerText();
    expect(text).toMatch(/may|might|could|likely contributing/);
    expect(text).not.toMatch(/probab|odds of|you will (get|be)|guaranteed/i);
    const first = findings.locator("> li").first();
    await first.getByText("Why? The evidence").click();
    await expect(first.locator("ul").first()).toBeVisible();

    await expect(page.getByTestId("caveats")).toContainText(
      "patterns in what you recorded, not causes",
    );
  });

  test("compares replies by how well the job fitted, once there are jobs to compare", async ({
    page,
  }) => {
    await page.goto("/analytics");
    await expect(
      page.getByRole("region", { name: "Replies by how well the job fitted" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Replies by resume" })).toBeVisible();
  });

  test("shows an empty state when nothing is tracked", async ({ page }) => {
    await page.goto("/applications");
    await page.getByRole("button", { name: "Clear sample applications" }).click();
    await expect(page.getByText("No applications yet")).toBeVisible();
    await page.goto("/analytics");
    await expect(page.getByText("Nothing to analyse yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to applications" })).toBeVisible();
  });
});

test.describe("career gaps", () => {
  test("ranks the skills that would improve the most matches, with the jobs that gain", async ({
    page,
  }) => {
    await page.goto("/gaps");
    await expect(page.getByRole("heading", { level: 1, name: "Career Gaps" })).toBeVisible();
    await expect(page.getByTestId("gap-scope")).toContainText(/Based on \d+ jobs/);
    const first = page.getByTestId("priorities").locator("> li").first();
    await expect(first).toContainText("Application Strength points");
    await expect(first).toContainText("If you have genuinely used");
    await expect(first).toContainText("Build a small project that really uses");
    await first.getByText("Why? Which jobs gain").click();
    await expect(first.getByRole("link").first()).toBeVisible();
    await expect(page.getByTestId("strengths")).toContainText("Python");
  });

  test("a skill leaves the list once it is in the verified profile", async ({ page }) => {
    await page.goto("/gaps");
    const first = page.getByTestId("priorities").locator("> li").first();
    const skill = (await first.getByRole("heading").innerText()).replace(/^\d+\.\s*/, "");
    await expect(page.getByTestId(`gap-${skill}`)).toBeVisible();

    await page.goto("/profile");
    await page
      .getByRole("region", { name: /^Skills/ })
      .getByRole("button", { name: "Add skill" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add skill" });
    await dialog.getByLabel("Skill", { exact: true }).fill(skill);
    await dialog.getByLabel("Level").selectOption("intermediate");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/gaps");
    await expect(page.getByTestId(`gap-${skill}`)).toHaveCount(0);
  });

  test("asks for a profile when nothing is verified", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Wipe demo data" }).click();
    await expect(page.getByText("Demo data wiped")).toBeVisible();
    await page.goto("/gaps");
    await expect(page.getByText("Build your verified profile first")).toBeVisible();
  });
});

test("the dashboard shows readiness with its evidence, and a short version of the insights", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const readiness = page.getByRole("region", { name: "Career readiness" });
  await expect(readiness.getByTestId("readiness-score")).toHaveText(/^\d+$/);
  await expect(readiness.getByTestId("readiness-parts").locator("> li")).toHaveCount(3);
  await expect(readiness).toContainText("says nothing about hiring odds");
  await expect(page.getByTestId("insights")).toContainText("Why am I not getting interviews?");
  await expect(page.getByText("Coming to this dashboard")).toHaveCount(0);
});

test("the analytics pages do not scroll sideways", async ({ page }) => {
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  for (const path of ["/analytics", "/gaps", "/dashboard"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await overflow(), path).toBe(false);
  }
});
