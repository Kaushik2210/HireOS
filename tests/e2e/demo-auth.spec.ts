import { expect, test } from "@playwright/test";

// Zero-key demo mode: there is no auth backend, so pages are open and say so.

test("auth pages explain demo mode instead of showing dead forms", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Demo mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|create account/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Continue to the demo" })).toBeVisible();
  }
});

test("the dashboard is reachable and labelled as demo mode", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
