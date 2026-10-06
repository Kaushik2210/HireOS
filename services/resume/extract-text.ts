import { extractText, getDocumentProxy } from "unpdf";
import {
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  MAX_ZIP_ENTRY_BYTES,
  PARSE_TIMEOUT_MS,
  type ResumeKind,
} from "@/lib/resume/constants";
import { listZipEntries, readZipEntry } from "@/lib/resume/zip";

export type ExtractErrorCode =
  "encrypted" | "active_content" | "too_many_pages" | "corrupt" | "timeout";

export class ExtractError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

export interface ExtractedText {
  /** Raw text as extracted, before normalization. */
  text: string;
  pages: number;
  warnings: string[];
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ExtractError("timeout", "Reading this file took too long.")),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function capLength(text: string, warnings: string[]): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  warnings.push("The document is very long, so only the first part was analysed.");
  return text.slice(0, MAX_TEXT_CHARS);
}

/* ---------------- PDF ---------------- */

async function extractPdf(bytes: Uint8Array): Promise<ExtractedText> {
  const warnings: string[] = [];
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const data = new Uint8Array(bytes);
  let pdf;
  try {
    const options = {
      isEvalSupported: false, // never compile document-supplied code
      disableFontFace: true,
      stopAtErrors: false,
    };
    pdf = await getDocumentProxy(data, options as never);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ExtractError("encrypted", "This PDF is password protected.");
    }
    throw new ExtractError("corrupt", "This PDF could not be read. It may be damaged.");
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractError(
        "too_many_pages",
        `This PDF has ${pdf.numPages} pages. Resumes longer than ${MAX_PDF_PAGES} pages are not supported.`,
      );
    }
    // Compressed object streams can hide scripts from the byte scan, so check structurally.
    const [hasScripts, attachments] = await Promise.all([
      pdf.hasJSActions(),
      pdf.getAttachments().catch(() => null),
    ]);
    if (hasScripts || (attachments && Object.keys(attachments).length > 0)) {
      throw new ExtractError(
        "active_content",
        "This PDF contains scripts or embedded files, which HireOS does not accept.",
      );
    }

    const { text } = await extractText(pdf, { mergePages: false });
    const joined = text.join("\n\n");
    return { text: capLength(joined, warnings), pages: pdf.numPages, warnings };
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError("corrupt", "This PDF could not be read. It may be damaged.");
  } finally {
    // Release parser memory. Which method exists varies between pdf.js releases.
    const handle = pdf as unknown as {
      destroy?: () => Promise<void>;
      cleanup?: () => Promise<void>;
    };
    await (handle.destroy ?? handle.cleanup)?.call(pdf)?.catch(() => undefined);
  }
}

/* ---------------- DOCX ---------------- */

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return safeCodePoint(parseInt(entity.slice(2), 16), whole);
    if (entity.startsWith("#")) return safeCodePoint(parseInt(entity.slice(1), 10), whole);
    return XML_ENTITIES[entity] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/**
 * Pulls visible text out of WordprocessingML with a tokenizer, not a full XML parse:
 * only paragraphs, runs, tabs, breaks, list markers and table cell boundaries matter.
 * Nothing is evaluated and no external entities are ever resolved.
 */
export function wordXmlToText(xml: string): string {
  const out: string[] = [];
  const tokens =
    /<w:p[\s>]|<\/w:p>|<w:numPr>|<w:tab\s*\/>|<w:br[^>]*\/>|<\/w:tc>|<\/w:tr>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let inList = false;
  let atLineStart = true;

  for (let match = tokens.exec(xml); match; match = tokens.exec(xml)) {
    const token = match[0];
    if (token.startsWith("<w:p") && !token.startsWith("<w:pPr")) {
      inList = false;
      atLineStart = true;
    } else if (token === "<w:numPr>") {
      inList = true;
    } else if (token === "</w:p>" || token === "</w:tr>") {
      out.push("\n");
      atLineStart = true;
    } else if (token === "</w:tc>" || token.startsWith("<w:tab")) {
      out.push("\t");
    } else if (token.startsWith("<w:br")) {
      out.push("\n");
      atLineStart = true;
    } else if (match[1] !== undefined) {
      if (inList && atLineStart) {
        out.push("• ");
        inList = false;
      }
      atLineStart = false;
      out.push(decodeEntities(match[1]));
    }
  }
  return out.join("");
}

const decoder = new TextDecoder("utf-8", { fatal: false });
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

async function extractDocx(bytes: Uint8Array): Promise<ExtractedText> {
  const warnings: string[] = [];
  try {
    const main = readZipEntry(bytes, "word/document.xml", MAX_ZIP_ENTRY_BYTES);
    if (!main) throw new ExtractError("corrupt", "This Word document has no readable body.");
    let text = wordXmlToText(decoder.decode(main));

    // Contact details are often placed in the page header, which many ATS tools skip.
    const headerNames = listZipEntries(bytes)
      .map((e) => e.name)
      .filter((n) => /^word\/header\d*\.xml$/i.test(n))
      .slice(0, 3);
    const headerText = headerNames
      .map((name) => {
        const entry = readZipEntry(bytes, name, MAX_ZIP_ENTRY_BYTES);
        return entry ? wordXmlToText(decoder.decode(entry)).trim() : "";
      })
      .filter(Boolean)
      .join("\n");
    if (headerText) {
      if (EMAIL.test(headerText) && !EMAIL.test(text)) {
        warnings.push(
          "Your email address is in the page header. Some applicant tracking systems skip headers, so repeat it in the main text.",
        );
      }
      text = `${headerText}\n${text}`;
    }
    return { text: capLength(text, warnings), pages: 1, warnings };
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    throw new ExtractError("corrupt", "This Word document could not be read. It may be damaged.");
  }
}

/** Extracts text from a file that has already passed `inspectUpload`. */
export function extractRawText(bytes: Uint8Array, kind: ResumeKind): Promise<ExtractedText> {
  const work = kind === "pdf" ? extractPdf(bytes) : extractDocx(bytes);
  return withTimeout(work, PARSE_TIMEOUT_MS);
}
