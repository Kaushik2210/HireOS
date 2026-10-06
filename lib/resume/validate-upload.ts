import {
  ALLOWED_EXTENSIONS,
  CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_RATIO,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  type ResumeKind,
} from "@/lib/resume/constants";
import { listZipEntries } from "@/lib/resume/zip";

export type RejectionCode =
  | "empty"
  | "too_large"
  | "bad_extension"
  | "legacy_format"
  | "bad_type"
  | "mismatch"
  | "encrypted"
  | "active_content"
  | "macro"
  | "zip_bomb"
  | "corrupt";

export type UploadInspection =
  | { ok: true; kind: ResumeKind; contentType: string; safeName: string }
  | { ok: false; code: RejectionCode; message: string };

const reject = (code: RejectionCode, message: string): UploadInspection => ({
  ok: false,
  code,
  message,
});

/**
 * Names are display-only: storage paths are generated server-side. Strips directories,
 * control characters and anything outside a conservative set, and bounds the length.
 */
export function sanitizeFileName(raw: string, kind: ResumeKind): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N} ._()-]/gu, "_");
  const stem = cleaned
    .replace(/\.[^.]*$/, "")
    .replace(/[. ]+$/g, "")
    .replace(/^[. ]+/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 80);
  return `${stem || "resume"}.${kind}`;
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.split(/[\\/]/).pop() ?? "");
  return match ? match[1]!.toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** Latin-1 view of the bytes: lossless, and lets us scan binary data with a regex. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/;
const PDF_ENCRYPTED = /\/Encrypt\b/;

/**
 * Drops binary stream bodies so keyword scans only see PDF syntax. Without this, random
 * compressed bytes could spell "/JS" and reject a legitimate file. Dictionaries hidden in
 * compressed object streams are caught afterwards by the structural checks in extraction.
 */
function stripStreams(text: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = text.indexOf("stream", cursor);
    if (open === -1) break;
    const close = text.indexOf("endstream", open + 6);
    if (close === -1) break;
    out += text.slice(cursor, open) + "stream ";
    // Resume after the whole "endstream" keyword, or its inner "stream" would be re-matched.
    cursor = close + "endstream".length;
  }
  return out + text.slice(cursor);
}

function inspectPdf(bytes: Uint8Array): UploadInspection | null {
  const text = stripStreams(latin1(bytes));
  if (PDF_ENCRYPTED.test(text)) {
    return reject(
      "encrypted",
      "This PDF is password protected. Remove the password and upload it again.",
    );
  }
  if (PDF_ACTIVE_CONTENT.test(text)) {
    return reject(
      "active_content",
      "This PDF contains scripts or embedded files, which HireOS does not accept. Export a plain PDF from your editor.",
    );
  }
  return null;
}

function inspectDocx(bytes: Uint8Array): UploadInspection | null {
  let entries;
  try {
    entries = listZipEntries(bytes);
  } catch {
    return reject(
      "corrupt",
      "This file looks damaged. Save it again from your editor and re-upload.",
    );
  }

  if (entries.length > MAX_ZIP_ENTRIES) {
    return reject("zip_bomb", "This file has an unusual structure and cannot be processed.");
  }
  let total = 0;
  for (const entry of entries) {
    total += entry.originalSize;
    const ratio =
      entry.size > 0 ? entry.originalSize / entry.size : entry.originalSize > 0 ? Infinity : 0;
    if (
      entry.originalSize > MAX_ZIP_ENTRY_BYTES ||
      (entry.originalSize > 1024 * 1024 && ratio > MAX_ZIP_RATIO)
    ) {
      return reject("zip_bomb", "This file has an unusual structure and cannot be processed.");
    }
  }
  if (total > MAX_ZIP_UNCOMPRESSED_BYTES) {
    return reject("zip_bomb", "This file has an unusual structure and cannot be processed.");
  }

  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
    return reject("bad_type", "This is not a Word document (.docx).");
  }
  for (const name of names) {
    if (
      /vbaProject\.bin$/i.test(name) ||
      /^word\/embeddings\//i.test(name) ||
      /^word\/activeX\//i.test(name)
    ) {
      return reject(
        "macro",
        "This document contains macros or embedded objects, which HireOS does not accept. Save a plain copy without them.",
      );
    }
  }
  return null;
}

/**
 * Decides whether an upload is acceptable from its content, never from the claimed type.
 * The extension must agree with what the bytes actually are.
 */
export function inspectUpload(input: { bytes: Uint8Array; fileName: string }): UploadInspection {
  const { bytes, fileName } = input;

  if (bytes.length === 0) return reject("empty", "The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return reject("too_large", `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }

  const ext = extensionOf(fileName);
  if (ext === "doc" || ext === "rtf" || ext === "odt") {
    return reject(
      "legacy_format",
      "Please save your resume as a PDF or a .docx file and upload that.",
    );
  }
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return reject("bad_extension", "Upload a PDF or a .docx file.");
  }

  // Magic bytes: PDF header may be preceded by a little junk, ZIP must start the file.
  const head = bytes.subarray(0, 1024);
  const isPdf = latin1(head).includes("%PDF-");
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);

  let kind: ResumeKind;
  if (isZip) kind = "docx";
  else if (isPdf) kind = "pdf";
  else
    return reject("bad_type", "This file is not a PDF or a Word document, whatever its name says.");

  if (kind !== ext) {
    return reject("mismatch", "The file's contents do not match its extension.");
  }

  const problem = kind === "pdf" ? inspectPdf(bytes) : inspectDocx(bytes);
  if (problem) return problem;

  return {
    ok: true,
    kind,
    contentType: CONTENT_TYPES[kind],
    safeName: sanitizeFileName(fileName, kind),
  };
}
