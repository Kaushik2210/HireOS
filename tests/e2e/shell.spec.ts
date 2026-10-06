import { expect, test } from "@playwright/test";

test("root redirects to the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("dashboard shows honest system status with no keys configured", async ({ page }) => {
  await page.goto("/dashboard");
  const status = page.getByRole("region", { name: "System status" });
  await expect(status.getByText("Configure API key")).toBeVisible();
});

test("command palette opens by keyboard and marks unbuilt actions as planned", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard shortcut is a desktop affordance");
  await page.goto("/dashboard");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Analyze resume")).toBeVisible();
  await expect(palette.getByText("Planned").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("mobile navigation opens and closes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await nav.getByRole("button", { name: "Close navigation" }).click();
  await expect(nav).toBeHidden();
});

test("unknown routes show the not-found page", async ({ page }) => {
  const response = await page.goto("/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("page does not overflow horizontally", async ({ page }) => {
  await page.goto("/dashboard");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
