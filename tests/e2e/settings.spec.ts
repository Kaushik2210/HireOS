import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.describe("privacy and data", () => {
  test("explains what is kept and offers a data download", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy & Data" })).toBeVisible();
    await expect(page.getByText("Demo mode", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Download your data" })).toBeVisible();
    await expect(page.getByRole("region", { name: "What is kept, and where" })).toBeVisible();
  });

  test("does not offer account deletion or session controls in a demo sandbox", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByRole("region", { name: "Delete your account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out everywhere" })).toHaveCount(0);
  });

  test("downloads a JSON file holding the sandbox data", async ({ page }) => {
    await page.goto("/settings");
    const button = page.getByRole("button", { name: "Download my data" });
    let download;
    // The page may still be hydrating: retry the click until the download starts.
    await expect(async () => {
      const wait = page.waitForEvent("download", { timeout: 3000 });
      await button.click();
      download = await wait;
    }).toPass();
    expect(download!.suggestedFilename()).toMatch(/^hireos-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile((await download!.path())!, "utf8"));
    expect(data.format).toBe("hireos-export-1");
    expect(data.account.demo).toBe(true);
    expect(data.profile.skills.length).toBeGreaterThan(0);
    expect(data.applications.length).toBe(5);
    await expect(page.getByText("Your export was saved as a file.")).toBeVisible();
  });
});

test.describe("content security policy", () => {
  test("a production page sends a nonce-based policy and the fixed security headers", async ({
    request,
  }) => {
    const res = await request.get("/dashboard");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("a different nonce on every request", async ({ request }) => {
    const nonce = async () =>
      /'nonce-([^']+)'/.exec(
        (await request.get("/dashboard")).headers()["content-security-policy"]!,
      )![1];
    expect(await nonce()).not.toBe(await nonce());
  });

  test("the app works under the policy: nothing is blocked on the main pages", async ({ page }) => {
    const violations: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __v: string[] }).__v = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    page.on("console", (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    for (const path of [
      "/dashboard",
      "/profile",
      "/jobs",
      "/matches",
      "/applications",
      "/interviews",
      "/analytics",
      "/graph",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      violations.push(
        ...(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).map(
          (v) => `${path}: ${v}`,
        ),
      );
    }
    // The command palette opens a dialog, which adds a style element at run time.
    await page.goto("/dashboard");
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1000 });
    }).toPass();
    violations.push(
      ...(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).map(
        (v) => `palette: ${v}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
