// @vitest-environment node
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/resume/constants";
import { inspectUpload, sanitizeFileName } from "@/lib/resume/validate-upload";
import { CLASSIC } from "../fixtures/resume-texts";
import {
  addZipEntries,
  fileOf,
  makeDocx,
  makePdf,
  pdfEncrypted,
  pdfWithJavaScript,
  zipBomb,
  zipWithManyEntries,
} from "../fixtures/files";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("accepting good files", () => {
  it("accepts a real PDF and reports its detected type", async () => {
    const r = inspectUpload(fileOf(await makePdf(CLASSIC), "Priya Menon Resume.pdf"));
    expect(r).toMatchObject({ ok: true, kind: "pdf", contentType: "application/pdf" });
  });

  it("accepts a real DOCX", async () => {
    const r = inspectUpload(fileOf(await makeDocx(CLASSIC), "resume.docx"));
    expect(r).toMatchObject({ ok: true, kind: "docx" });
  });

  it("accepts upper-case extensions", async () => {
    expect(inspectUpload(fileOf(await makePdf("hello"), "RESUME.PDF")).ok).toBe(true);
  });
});

describe("rejecting by size and name", () => {
  it("rejects an empty file", () => {
    expect(inspectUpload(fileOf(new Uint8Array(0), "a.pdf"))).toMatchObject({
      ok: false,
      code: "empty",
    });
  });

  it("rejects anything over the size limit, before looking inside", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(bytes("%PDF-1.4"));
    expect(inspectUpload(fileOf(big, "a.pdf"))).toMatchObject({ ok: false, code: "too_large" });
  });

  it.each(["resume.doc", "resume.rtf", "resume.odt"])(
    "explains that %s is not supported",
    (name) => {
      expect(inspectUpload(fileOf(bytes("x"), name))).toMatchObject({
        ok: false,
        code: "legacy_format",
      });
    },
  );

  it.each(["resume.exe", "resume.txt", "resume", "resume.pdf.exe", "resume.html", "resume.svg"])(
    "rejects the extension of %s",
    (name) => {
      expect(inspectUpload(fileOf(bytes("%PDF-1.4"), name))).toMatchObject({
        ok: false,
        code: "bad_extension",
      });
    },
  );
});

describe("never trusting the extension or claimed type", () => {
  it("rejects an executable renamed to .pdf", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, ...new Array(200).fill(0)]);
    expect(inspectUpload(fileOf(exe, "resume.pdf"))).toMatchObject({ ok: false, code: "bad_type" });
  });

  it("rejects a text or HTML file renamed to .pdf or .docx", () => {
    expect(
      inspectUpload(fileOf(bytes("<html><script>alert(1)</script></html>"), "a.pdf")),
    ).toMatchObject({
      ok: false,
      code: "bad_type",
    });
    expect(inspectUpload(fileOf(bytes("just text"), "a.docx"))).toMatchObject({
      ok: false,
      code: "bad_type",
    });
  });

  it("rejects a PDF named .docx and a DOCX named .pdf", async () => {
    expect(inspectUpload(fileOf(await makePdf("x"), "a.docx"))).toMatchObject({
      ok: false,
      code: "mismatch",
    });
    expect(inspectUpload(fileOf(await makeDocx("x"), "a.pdf"))).toMatchObject({
      ok: false,
      code: "mismatch",
    });
  });

  it("rejects an arbitrary ZIP that is not a Word document", () => {
    const zip = zipSync({ "readme.txt": bytes("hi") });
    expect(inspectUpload(fileOf(zip, "a.docx"))).toMatchObject({ ok: false, code: "bad_type" });
  });

  it("rejects a corrupt ZIP that only has the right first bytes", () => {
    const fake = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(100).fill(7)]);
    expect(inspectUpload(fileOf(fake, "a.docx"))).toMatchObject({ ok: false, code: "corrupt" });
  });
});

describe("active and hostile content", () => {
  it("rejects a PDF containing JavaScript", () => {
    expect(inspectUpload(fileOf(pdfWithJavaScript(), "a.pdf"))).toMatchObject({
      ok: false,
      code: "active_content",
    });
  });

  it("rejects an encrypted PDF", () => {
    expect(inspectUpload(fileOf(pdfEncrypted(), "a.pdf"))).toMatchObject({
      ok: false,
      code: "encrypted",
    });
  });

  it("rejects a macro-enabled document", async () => {
    const docx = addZipEntries(await makeDocx("x"), { "word/vbaProject.bin": bytes("macro") });
    expect(inspectUpload(fileOf(docx, "a.docx"))).toMatchObject({ ok: false, code: "macro" });
  });

  it("rejects embedded objects", async () => {
    const docx = addZipEntries(await makeDocx("x"), {
      "word/embeddings/oleObject1.bin": bytes("ole"),
    });
    expect(inspectUpload(fileOf(docx, "a.docx"))).toMatchObject({ ok: false, code: "macro" });
  });

  it("rejects a decompression bomb by its declared size", () => {
    const bomb = zipBomb();
    expect(bomb.length).toBeLessThan(MAX_UPLOAD_BYTES); // small on disk, huge when inflated
    expect(inspectUpload(fileOf(bomb, "a.docx"))).toMatchObject({ ok: false, code: "zip_bomb" });
  });

  it("rejects an archive with an absurd number of entries", () => {
    expect(inspectUpload(fileOf(zipWithManyEntries(800), "a.docx"))).toMatchObject({
      ok: false,
      code: "zip_bomb",
    });
  });

  it("does not reject a legitimate PDF just because compressed bytes happen to spell a keyword", async () => {
    const pdf = await makePdf(CLASSIC);
    // Append a fake stream whose binary body contains the byte pattern "/JS " and "/Encrypt".
    const body = bytes("stream\n/JS /JavaScript /Encrypt /Launch\nendstream\n");
    const combined = new Uint8Array(pdf.length + body.length);
    combined.set(pdf);
    combined.set(body, pdf.length);
    expect(inspectUpload(fileOf(combined, "a.pdf")).ok).toBe(true);
  });

  it("still catches keywords placed between streams (the scan resumes after endstream)", () => {
    const sneaky = bytes(
      "%PDF-1.4\n1 0 obj\nstream\nAAAA\nendstream\nendobj\n2 0 obj\n<< /S /JavaScript /JS (x) >>\nendobj\n3 0 obj\nstream\nBBBB\nendstream\nendobj",
    );
    expect(inspectUpload(fileOf(sneaky, "a.pdf"))).toMatchObject({
      ok: false,
      code: "active_content",
    });
  });
});

describe("sanitizeFileName", () => {
  it.each([
    ["../../etc/passwd.pdf", "passwd.pdf"],
    ["C:\\Users\\me\\resume.pdf", "resume.pdf"],
    ["resume\u0000.pdf", "resume.pdf"],
    ["my resume (final).pdf", "my resume (final).pdf"],
    ["<script>alert(1)</script>.pdf", "script_.pdf"],
    ["a<b>c|d?.pdf", "a_b_c_d_.pdf"],
    ["", "resume.pdf"],
    ["....pdf", "resume.pdf"],
    ["Résumé – Zoë.pdf", "Résumé _ Zoë.pdf"],
  ])("cleans %j", (input, expected) => {
    expect(sanitizeFileName(input, "pdf")).toBe(expected);
  });

  it("bounds the length and always ends with the detected extension", () => {
    const name = sanitizeFileName(`${"a".repeat(500)}.exe`, "docx");
    expect(name.length).toBeLessThanOrEqual(85);
    expect(name.endsWith(".docx")).toBe(true);
  });
});
