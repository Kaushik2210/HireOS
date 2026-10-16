import { expect, test } from "@playwright/test";

// Each test has its own browser context, so its own isolated demo sandbox (Asha, with five
// sample applications).

test.describe("career graph", () => {
  test("draws the person, their verified items, jobs and applications", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.getByRole("heading", { level: 1, name: "Career Graph" })).toBeVisible();
    await expect(page.getByText("Demo data", { exact: true }).first()).toBeVisible();

    const svg = page.getByTestId("graph-svg");
    await expect(svg).toBeVisible();
    for (const type of [
      "user",
      "skill",
      "project",
      "job",
      "company",
      "application",
      "outcome",
      "gap",
    ]) {
      await expect(svg.getByTestId(`node-${type}`).first(), type).toBeVisible();
    }
    await expect(svg.getByTestId("node-user")).toHaveCount(1);
    await expect(svg.getByTestId("node-application")).toHaveCount(5);
    await expect(page.getByText(/\d+ items, \d+ connections/)).toBeVisible();
  });

  test("selecting an item shows what it connects to and where to open it", async ({ page }) => {
    await page.goto("/graph");
    const project = page.locator(
      '[data-testid="node-project"][data-label="Campus Placement Tracker"]',
    );
    await project.click();
    const details = page.getByTestId("details");
    await expect(details).toContainText("Campus Placement Tracker");
    await expect(details.getByTestId("connections")).toContainText("Django");
    await expect(details.getByTestId("connections")).toContainText("uses");
    await expect(details.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/profile");

    // Following a connection moves the selection.
    await details.getByRole("button", { name: "Django" }).click();
    await expect(details.getByRole("heading", { name: "Django" })).toBeVisible();

    await details.getByRole("button", { name: "Clear selection" }).click();
    await expect(details).toContainText("Select an item to see what connects to it");
  });

  test("a skill the person lacks is drawn apart, as a gap, and not as something they have", async ({
    page,
  }) => {
    await page.goto("/graph");
    const gap = page.locator('[data-testid="node-gap"][data-label="Docker"]');
    await gap.click();
    const details = page.getByTestId("details");
    await expect(details).toContainText("Skills asked for that you lack");
    await expect(details).toContainText("not in your verified profile");
    await expect(details.getByTestId("connections")).toContainText("asks for (you lack) this");
    await expect(details.getByTestId("connections")).not.toContainText("has");
    await expect(details.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/gaps");
  });

  test("a job opens its page and an application opens the pipeline", async ({ page }) => {
    await page.goto("/graph");
    await page.locator('[data-testid="node-job"]').first().click();
    const link = page.getByTestId("details").getByRole("link", { name: "Open" });
    await expect(link).toHaveAttribute("href", /^\/jobs\/[0-9a-f-]{36}$/);
    await page.locator('[data-testid="node-application"]').first().click();
    await expect(page.getByTestId("details").getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      /^\/applications\/[0-9a-f-]{36}$/,
    );
  });

  test("filters hide a kind of item and its connections", async ({ page }) => {
    await page.goto("/graph");
    const svg = page.getByTestId("graph-svg");
    const before = await svg.getByTestId("node-skill").count();
    expect(before).toBeGreaterThan(0);
    await page
      .getByTestId("filters")
      .getByLabel(/Skills you have/)
      .uncheck();
    await expect(svg.getByTestId("node-skill")).toHaveCount(0);
    await expect(svg.getByTestId("node-project").first()).toBeVisible();
    await page
      .getByTestId("filters")
      .getByLabel(/Skills you have/)
      .check();
    await expect(svg.getByTestId("node-skill")).toHaveCount(before);
  });

  test("works from the keyboard", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard focus is a desktop affordance");
    await page.goto("/graph");
    const node = page.locator('[data-testid="node-skill"]').first();
    // The page may still be hydrating, which can drop focus once: retry until it holds.
    await expect(async () => {
      await node.focus();
      await expect(node).toBeFocused({ timeout: 1000 });
    }).toPass();
    await page.keyboard.press("Enter");
    await expect(node).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("details").getByTestId("connections")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(node).toHaveAttribute("aria-pressed", "false");
    await expect(node).toHaveAttribute("aria-label", /Press Enter to see what it connects to/);
  });

  test("zooms in and resets", async ({ page }) => {
    await page.goto("/graph");
    const svg = page.getByTestId("graph-svg");
    const base = (await svg.boundingBox())!.width;
    // Clicks made before the page has hydrated do nothing, so repeat until the view changes.
    await expect(async () => {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect
        .poll(async () => (await svg.boundingBox())!.width, { timeout: 2000 })
        .toBeGreaterThan(base * 1.5);
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(async () => (await svg.boundingBox())!.width).toBeLessThan(base * 1.1);
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });

  test("offers the same information as a plain list", async ({ page }) => {
    await page.goto("/graph");
    await page.getByText("View as a list").click();
    const list = page.getByTestId("graph-list");
    await expect(list).toBeVisible();
    await expect(
      list.getByRole("row", { name: /^Campus Placement Tracker Projects/ }),
    ).toContainText("Django");
    await expect(list.getByRole("row", { name: /^Docker Skills asked for/ })).toContainText(
      "Skills asked for that you lack",
    );
  });

  test("shows only what changes with the profile: a new skill becomes an item, not a gap", async ({
    page,
  }) => {
    await page.goto("/graph");
    await expect(page.locator('[data-testid="node-gap"][data-label="Docker"]')).toHaveCount(1);
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

    await page.goto("/graph");
    await expect(page.locator('[data-testid="node-gap"][data-label="Docker"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="node-skill"][data-label="Docker"]')).toHaveCount(1);
  });

  test("asks for a verified profile when there is nothing to draw", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Wipe demo data" }).click();
    await expect(page.getByText("Demo data wiped")).toBeVisible();
    await page.goto("/graph");
    await expect(page.getByText("Build your verified profile first")).toBeVisible();
    await expect(page.getByTestId("graph-svg")).toHaveCount(0);
  });

  test("does not scroll the page sideways, even zoomed in", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.getByTestId("graph-svg")).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
    expect(await overflow()).toBe(false);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await overflow()).toBe(false);
  });
});
