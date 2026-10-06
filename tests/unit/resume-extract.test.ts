// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES } from "@/lib/resume/constants";
import { ExtractError, extractRawText, wordXmlToText } from "@/services/resume/extract-text";
import { normalizeText } from "@/services/resume/normalize";
import { parseResumeText } from "@/services/resume/parse";
import { CLASSIC, PIPE_STYLE } from "../fixtures/resume-texts";
import { makeDocx, makePdf } from "../fixtures/files";

async function parseFile(bytes: Uint8Array, kind: "pdf" | "docx") {
  const extracted = await extractRawText(bytes, kind);
  return parseResumeText({
    rawText: extracted.text,
    pages: extracted.pages,
    extractionWarnings: extracted.warnings,
  });
}

describe("PDF extraction", () => {
  it("round-trips a real PDF through extraction and parsing", async () => {
    const { parsed } = await parseFile(await makePdf(CLASSIC), "pdf");
    expect(parsed.contact.full_name).toBe("Priya Menon");
    expect(parsed.contact.email).toBe("priya.menon@example.com");
    expect(parsed.experiences[0]).toMatchObject({
      title: "Backend Developer Intern",
      organization: "Brightleaf Software",
    });
    expect(parsed.projects.map((p) => p.name)).toEqual([
      "Campus Placement Tracker",
      "Expense Splitter API",
    ]);
    expect(parsed.education).toHaveLength(2);
    expect(parsed.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["Python", "Django", "PostgreSQL"]),
    );
    expect(parsed.stats.pages).toBe(1);
  });

  it("counts pages", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    const extracted = await extractRawText(await makePdf(long, { linesPerPage: 50 }), "pdf");
    expect(extracted.pages).toBe(3);
  });

  it("refuses a PDF with more pages than allowed", async () => {
    const tooLong = Array.from({ length: MAX_PDF_PAGES * 10 + 10 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const bytes = await makePdf(tooLong, { linesPerPage: 10 });
    await expect(extractRawText(bytes, "pdf")).rejects.toMatchObject({ code: "too_many_pages" });
  });

  it("returns almost no text for an image-only PDF instead of failing", async () => {
    const extracted = await extractRawText(await makePdf(""), "pdf");
    expect(normalizeText(extracted.text).length).toBeLessThan(10);
  });

  it("reports a damaged PDF as corrupt, never as a crash", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf at all");
    await expect(extractRawText(bytes, "pdf")).rejects.toBeInstanceOf(ExtractError);
    await expect(extractRawText(bytes, "pdf")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("does not mutate the caller's buffer", async () => {
    const bytes = await makePdf("hello world");
    const copy = new Uint8Array(bytes);
    await extractRawText(bytes, "pdf");
    expect(bytes).toEqual(copy);
  });
});

describe("DOCX extraction", () => {
  it("round-trips a real DOCX, reading list paragraphs as bullets", async () => {
    const { parsed, text } = await parseFile(await makeDocx(PIPE_STYLE), "docx");
    expect(text).toContain("• Developed customer onboarding flows");
    expect(parsed.contact.email).toBe("rahul.verma@example.com");
    expect(parsed.experiences).toHaveLength(2);
    expect(parsed.experiences[0]!.highlights).toHaveLength(3);
  });

  it("includes header text and warns when the email lives only in the header", async () => {
    const body =
      "Some Person\n\nEXPERIENCE\nEngineer | Acme Ltd | Jan 2024 - Present\n• Built things";
    const extracted = await extractRawText(
      await makeDocx(body, { header: "contact@example.com" }),
      "docx",
    );
    expect(extracted.text).toContain("contact@example.com");
    expect(extracted.warnings.join(" ")).toMatch(/email address is in the page header/i);
  });

  it("reports a docx with a missing body as corrupt", async () => {
    const { zipSync } = await import("fflate");
    const hollow = zipSync({ "[Content_Types].xml": new TextEncoder().encode("<Types/>") });
    await expect(extractRawText(hollow, "docx")).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("wordXmlToText", () => {
  it("handles runs, tabs, breaks, entities and table cells", () => {
    const xml =
      '<w:p><w:r><w:t>R&amp;D </w:t></w:r><w:r><w:t xml:space="preserve">Lead</w:t></w:r><w:tab/><w:r><w:t>2024</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>Line one</w:t></w:r><w:br/><w:r><w:t>Line two</w:t></w:r></w:p>" +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    const text = wordXmlToText(xml);
    expect(text).toContain("R&D Lead\t2024");
    expect(text).toContain("Line one\nLine two");
    expect(text.indexOf("A")).toBeLessThan(text.indexOf("B"));
    expect(text).toContain("\t");
  });

  it("decodes numeric entities safely and leaves invalid ones alone", () => {
    expect(
      wordXmlToText("<w:p><w:r><w:t>&#65;&#x42;&#99999999;&bogus;</w:t></w:r></w:p>"),
    ).toContain("AB&#99999999;&bogus;");
  });

  it("does not resolve external entities or execute anything", () => {
    const xxe =
      '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:p><w:r><w:t>&x;</w:t></w:r></w:p>';
    expect(wordXmlToText(xxe)).toContain("&x;");
    expect(wordXmlToText(xxe)).not.toContain("root:");
  });
});

describe("normalizeText", () => {
  it("expands ligatures, unifies bullets and spaces, and removes invisible characters", () => {
    const raw = "Efﬁcient   engineer​\n▪ Built  things\n- Fixed bugs\n*  Shipped\n\n\n\nEnd";
    expect(normalizeText(raw)).toBe(
      "Efficient engineer\n• Built things\n• Fixed bugs\n• Shipped\n\nEnd",
    );
  });

  it("does not turn a hyphenated word or a date range into a bullet", () => {
    expect(normalizeText("Full-stack developer\n2021 - 2024")).toBe(
      "Full-stack developer\n2021 - 2024",
    );
  });

  it("drops control characters but keeps tabs out of the way", () => {
    expect(normalizeText("a\u0000b\u0007c\td")).toBe("abc d");
  });
});
