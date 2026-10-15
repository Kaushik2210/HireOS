import { expect, test as base, type Page } from "@playwright/test";
import { CLASSIC } from "../fixtures/resume-texts";
import { makeDocx, makePdf, pdfWithJavaScript } from "../fixtures/files";

// Uploads are limited per client address (a real protection), and every test here comes from
// the same machine. Each test presents its own address so a full run does not use up the
// allowance of the next one.
const test = base.extend({
  extraHTTPHeaders: async ({}, provide) => {
    const octet = () => Math.floor(Math.random() * 254) + 1;
    await provide({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
  },
});

// Real files, built on the fly, go through the real production server. Each test has its own
// browser context, so its own isolated demo sandbox.

/**
 * Chooses a file and waits until something happens: the upload request goes out, or the form
 * rejects the file on the spot. A file chosen before React has hydrated is silently lost (the
 * change handler is not attached yet), so the choice is repeated until it takes.
 */
async function upload(page: Page, name: string, bytes: Uint8Array, mimeType = "application/pdf") {
  const file = { name, mimeType, buffer: Buffer.from(bytes) };
  await expect(async () => {
    const reacted = Promise.any([
      page.waitForRequest((r) => r.url().includes("/api/resumes") && r.method() === "POST", {
        timeout: 2500,
      }),
      page.locator('p[role="alert"]').waitFor({ state: "visible", timeout: 2500 }),
    ]);
    await page.locator("#resume-file").setInputFiles(file);
    await reacted;
  }).toPass({ timeout: 20_000 });
}

async function uploadClassic(page: Page, name = "Priya Menon Resume.pdf") {
  await page.goto("/resume");
  await upload(page, name, await makePdf(CLASSIC));
  await expect(page).toHaveURL(/\/resume\/[0-9a-f-]{36}$/);
}

test("uploads a real PDF, parses it, and shows the analysis", async ({ page }) => {
  await uploadClassic(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Priya Menon Resume.pdf" }),
  ).toBeVisible();

  const found = page.getByRole("region", { name: "Analysis" });
  await expect(found.getByText("Priya Menon", { exact: true })).toBeVisible();
  await expect(found.locator("dd", { hasText: "priya.menon@example.com" })).toBeVisible();
  await expect(found.getByText("Experience", { exact: true }).first()).toBeVisible();

  const health = page.getByRole("complementary", { name: "Resume health" });
  await expect(health.getByRole("progressbar", { name: "Resume health" })).toHaveAttribute(
    "aria-valuenow",
    /^\d+$/,
  );
  await expect(health.getByText("ATS compatibility")).toBeVisible();
  await expect(health.getByText("Impact")).toBeVisible();
});

test("uploads a real DOCX too", async ({ page }) => {
  await page.goto("/resume");
  await upload(
    page,
    "cv.docx",
    await makeDocx(CLASSIC),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  await expect(page).toHaveURL(/\/resume\/[0-9a-f-]{36}$/);
  await expect(page.locator("dd", { hasText: "priya.menon@example.com" })).toBeVisible();
});

test("shows what an applicant tracking system reads", async ({ page }) => {
  await uploadClassic(page);
  await page.getByText("What an applicant tracking system reads").click();
  await expect(page.locator("pre")).toContainText("Brightleaf Software");
});

test("lists uploaded resumes, and the same file uploaded again opens the existing one", async ({
  page,
}) => {
  // pdf-lib stamps each file with a creation time, so reuse one set of bytes for "the same file".
  const bytes = await makePdf(CLASSIC);
  await page.goto("/resume");
  await upload(page, "Priya Menon Resume.pdf", bytes);
  await expect(page).toHaveURL(/\/resume\/[0-9a-f-]{36}$/);
  const firstUrl = page.url();

  await page.goto("/resume");
  await expect(page.getByRole("region", { name: /^Your resumes/ }).getByRole("link")).toHaveCount(
    1,
  );

  await upload(page, "renamed copy.pdf", bytes);
  await expect(page).toHaveURL(firstUrl);
  await page.goto("/resume");
  await expect(page.getByRole("region", { name: /^Your resumes/ }).getByRole("link")).toHaveCount(
    1,
  );
});

test.describe("rejections", () => {
  test("an executable renamed to .pdf is rejected by content, with a clear message", async ({
    page,
  }) => {
    await page.goto("/resume");
    await upload(
      page,
      "totally-a-resume.pdf",
      new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]),
    );
    await expect(page.locator('p[role="alert"]')).toContainText(/not a PDF or a Word document/i);
    await expect(page).toHaveURL(/\/resume$/);
  });

  test("a PDF containing JavaScript is rejected", async ({ page }) => {
    await page.goto("/resume");
    await upload(page, "scripted.pdf", pdfWithJavaScript());
    await expect(page.locator('p[role="alert"]')).toContainText(/scripts or embedded files/i);
  });

  test("a text file is rejected before upload", async ({ page }) => {
    await page.goto("/resume");
    await upload(page, "notes.txt", new TextEncoder().encode("hello"), "text/plain");
    await expect(page.locator('p[role="alert"]')).toContainText(/PDF or a .docx/i);
  });

  test("a legacy .doc file gets guidance", async ({ page }) => {
    await page.goto("/resume");
    await upload(page, "old.doc", new Uint8Array([1, 2, 3]), "application/msword");
    await expect(page.locator('p[role="alert"]')).toContainText(/save your resume as a PDF/i);
  });

  test("an oversized file is rejected", async ({ page }) => {
    await page.goto("/resume");
    const big = new Uint8Array(4 * 1024 * 1024 + 10);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    await upload(page, "huge.pdf", big);
    await expect(page.locator('p[role="alert"]')).toContainText(/larger than 4 MB/i);
  });

  test("a damaged PDF is reported as unreadable", async ({ page }) => {
    await page.goto("/resume");
    await upload(
      page,
      "broken.pdf",
      new TextEncoder().encode("%PDF-1.4\nthis is not a real document"),
    );
    await expect(page.locator('p[role="alert"]')).toContainText(/could not be read/i);
  });
});

test("adds parsed items to the profile as unconfirmed, then confirms them after review", async ({
  page,
}) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await expect(page.getByRole("heading", { name: "Create your profile" })).toBeVisible();

  await uploadClassic(page);
  await page.getByRole("button", { name: "Add to profile for review" }).click();
  await expect(page.getByText(/Added \d+ items for your review/)).toBeVisible();
  await expect(page.getByText(/created your profile/)).toBeVisible();

  await page.getByRole("link", { name: "Review on your profile" }).click();
  const review = page.getByRole("region", { name: /^Needs your review/ });
  await expect(review).toBeVisible();
  // Let React hydrate the freshly navigated page before clicking its client-side buttons.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Priya Menon" })).toBeVisible();

  // Unconfirmed items are labelled and do not count toward completeness yet.
  await expect(page.getByText("Unconfirmed").first()).toBeVisible();
  const bar = page.getByRole("progressbar", { name: "Profile completeness" });
  const before = Number(await bar.getAttribute("aria-valuenow"));
  await expect(page.getByText(/needs? your review|need your review/).first()).toBeVisible();

  // Confirm one item.
  const count = async () =>
    Number((await review.getByRole("heading").innerText()).match(/(\d+)\s*$/)?.[1]);
  const start = await count();
  await review
    .getByRole("button", { name: /^Confirm (?!all)/ })
    .first()
    .click();
  await expect.poll(count).toBe(start - 1);

  // Confirm everything, through the two-step prompt.
  await review.getByRole("button", { name: /^Confirm all/ }).click();
  await expect(review.getByText("I have read every item.")).toBeVisible();
  await review.getByRole("button", { name: "Yes, confirm all" }).click();
  await expect(review).toBeHidden();

  const after = Number(await bar.getAttribute("aria-valuenow"));
  expect(after).toBeGreaterThan(before);
  await expect(page.getByText("Unconfirmed")).toHaveCount(0);
});

test("importing the same resume twice adds nothing the second time", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Wipe demo data" }).click();
  await uploadClassic(page);
  await page.getByRole("button", { name: "Add to profile for review" }).click();
  await expect(page.getByText(/Added \d+ items/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add to profile for review" })).toBeDisabled();
  await expect(page.getByText(/already in your profile/i)).toBeVisible();
});

test("deletes a resume with a confirmation step", async ({ page }) => {
  await uploadClassic(page);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page).toHaveURL(/\/resume$/);
  await expect(page.getByText("No resumes yet")).toBeVisible();
});

test("demo mode keeps no original file and offers no download", async ({ page, request }) => {
  await uploadClassic(page);
  await expect(page.getByRole("link", { name: /Download original/ })).toHaveCount(0);
  const id = page.url().split("/").pop()!;
  const res = await page.request.get(`/api/resumes/${id}/file`, { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  expect((await request.get("/api/resumes/not-a-uuid/file")).status()).toBe(404);
});

test("another visitor cannot see or open a resume", async ({ page, browser }) => {
  await uploadClassic(page);
  const url = page.url();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/resume");
  await expect(otherPage.getByText("No resumes yet")).toBeVisible();
  await otherPage.goto(url);
  // The page streams behind a loading state, so the status is already 200 when it turns out
  // the resume is not this visitor's. What matters is that nothing of it is shown.
  await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(otherPage.getByText("Priya Menon")).toHaveCount(0);
  await other.close();
});

test("the upload endpoint refuses cross-site and header-less requests", async ({ page }) => {
  await page.goto("/resume");
  const multipart = {
    file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
  };

  const crossSite = await page.request.post("/api/resumes", {
    multipart,
    headers: { origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);

  const anonymousClient = await page.request.post("/api/resumes", { multipart });
  expect(anonymousClient.status()).toBe(403);
});

test("the upload endpoint rejects bad bodies with clear errors", async ({ page, baseURL }) => {
  await page.goto("/resume");
  const headers = { origin: baseURL! };

  const notMultipart = await page.request.post("/api/resumes", { headers, data: { file: "x" } });
  expect(notMultipart.status()).toBe(415);

  const noFile = await page.request.post("/api/resumes", { headers, multipart: { other: "x" } });
  expect(noFile.status()).toBe(400);

  const bad = await page.request.post("/api/resumes", {
    headers,
    multipart: {
      file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") },
    },
  });
  expect(bad.status()).toBe(415);
  expect(bad.headers()["cache-control"]).toBe("no-store");
});

test("the resume pages do not scroll sideways", async ({ page }) => {
  await page.goto("/resume");
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(false);
  await upload(page, "Priya.pdf", await makePdf(CLASSIC));
  await expect(page).toHaveURL(/\/resume\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await overflow()).toBe(false);
});
