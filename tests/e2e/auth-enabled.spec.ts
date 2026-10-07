import { expect, test } from "@playwright/test";

// Runs against a server with auth enabled but no reachable Supabase. Everything that
// does not need a real account is verifiable here: routing, validation, failure states.

test("protected pages redirect signed-out visitors to login and remember the destination", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the matches page is protected", async ({ page }) => {
  await page.goto("/matches");
  await expect(page).toHaveURL(/\/login\?next=%2Fmatches$/);
});

test("documents and tailoring pages are protected", async ({ page }) => {
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments$/);
  await page.goto("/jobs/00000000-0000-4000-8000-000000000000/tailor");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("the root path goes to login without a next parameter", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("unknown routes are protected too (default deny)", async ({ page }) => {
  await page.goto("/some/unbuilt/page");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("password reset page needs a session", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/login/);
});

test("login validates fields on the client with accessible errors", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();

  const email = page.getByLabel("Email");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter your email")).toBeVisible();
  await expect(page.getByText("Enter your password")).toBeVisible();
});

test("a backend outage is reported as unavailable, not as wrong credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/temporarily unavailable/i)).toBeVisible();
});

test("sign-up enforces password rules and matching confirmation", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill("new@example.com");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("different");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();
  await expect(page.getByText("Passwords do not match")).toBeVisible();
});

test("shows the session-expired notice and the invalid-link notice", async ({ page }) => {
  await page.goto("/login?reason=expired");
  await expect(page.getByText(/session expired/i)).toBeVisible();

  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/login\?error=callback$/);
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
});

test("forgot-password validates the email", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
});

test("hostile next values never leave the site", async ({ page }) => {
  await page.goto("/login?next=https://evil.example");
  // The form renders and the destination is sanitised server-side (covered in unit tests);
  // here we confirm the page does not navigate away.
  await expect(page).toHaveURL(/localhost:3101\/login/);
});

test("the profile page is protected", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);
});

test("the upload API answers signed-out callers with a JSON 401, not a redirect", async ({
  request,
  baseURL,
}) => {
  const res = await request.post("/api/resumes", {
    headers: { origin: baseURL! },
    multipart: {
      file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ code: "auth" });

  const download = await request.get("/api/resumes/11111111-1111-4111-8111-111111111111/file", {
    maxRedirects: 0,
  });
  expect(download.status()).toBe(401);
});

test("the resume pages are protected", async ({ page }) => {
  await page.goto("/resume");
  await expect(page).toHaveURL(/\/login\?next=%2Fresume$/);
});

test("the jobs pages are protected", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page).toHaveURL(/\/login\?next=%2Fjobs$/);
  await page.goto("/jobs/11111111-1111-4111-8111-111111111111");
  await expect(page).toHaveURL(/\/login\?next=/);
});
