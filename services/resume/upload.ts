import { createHash, randomUUID } from "node:crypto";
import { ResumeStoreError, type ResumeStore, type ResumeSummary } from "@/db/resume/store";
import { MAX_RESUMES_PER_USER } from "@/lib/resume/constants";
import { inspectUpload, type RejectionCode } from "@/lib/resume/validate-upload";
import { ExtractError, extractRawText } from "@/services/resume/extract-text";
import { computeResumeHealth } from "@/services/resume/health";
import { parseResumeText } from "@/services/resume/parse";

export type UploadFailure = {
  ok: false;
  /** HTTP status to respond with. */
  status: 400 | 409 | 413 | 415 | 422 | 500;
  code: RejectionCode | "limit" | "extract" | "storage";
  message: string;
};

export type UploadOutcome = { ok: true; resume: ResumeSummary; duplicate: boolean } | UploadFailure;

const STATUS_FOR: Record<RejectionCode, UploadFailure["status"]> = {
  empty: 400,
  too_large: 413,
  bad_extension: 415,
  legacy_format: 415,
  bad_type: 415,
  mismatch: 415,
  encrypted: 422,
  active_content: 422,
  macro: 422,
  zip_bomb: 422,
  corrupt: 422,
};

/**
 * The whole upload pipeline for one file, in order: validate the content, de-duplicate,
 * enforce the per-user limit, extract text, parse, score, then store. Nothing is stored
 * unless every earlier step succeeded, and the file is never executed or rendered.
 */
export async function processResumeUpload(input: {
  userId: string;
  bytes: Uint8Array;
  fileName: string;
  store: ResumeStore;
}): Promise<UploadOutcome> {
  const { userId, bytes, fileName, store } = input;

  const inspection = inspectUpload({ bytes, fileName });
  if (!inspection.ok) {
    return {
      ok: false,
      status: STATUS_FOR[inspection.code],
      code: inspection.code,
      message: inspection.message,
    };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await store.findByHash(userId, sha256);
  if (existing) return { ok: true, resume: existing, duplicate: true };

  if ((await store.count(userId)) >= MAX_RESUMES_PER_USER) {
    return {
      ok: false,
      status: 409,
      code: "limit",
      message: `You can keep up to ${MAX_RESUMES_PER_USER} resumes. Delete one to upload another.`,
    };
  }

  let extracted;
  try {
    extracted = await extractRawText(bytes, inspection.kind);
  } catch (error) {
    if (error instanceof ExtractError) {
      return { ok: false, status: 422, code: "extract", message: error.message };
    }
    return {
      ok: false,
      status: 422,
      code: "extract",
      message: "This file could not be read. It may be damaged.",
    };
  }

  const { text, parsed } = parseResumeText({
    rawText: extracted.text,
    pages: extracted.pages,
    extractionWarnings: extracted.warnings,
  });
  const health = computeResumeHealth({ text, parsed });

  try {
    const resume = await store.create(
      userId,
      {
        id: randomUUID(),
        file_name: inspection.safeName,
        kind: inspection.kind,
        size_bytes: bytes.length,
        sha256,
        page_count: Math.min(Math.max(extracted.pages, 1), 10),
        extracted_text: text,
        parsed,
        health,
      },
      bytes,
    );
    return { ok: true, resume, duplicate: false };
  } catch (error) {
    // A concurrent upload of the same file: report the winner instead of an error.
    if (error instanceof ResumeStoreError && error.kind === "duplicate") {
      const winner = await store.findByHash(userId, sha256);
      if (winner) return { ok: true, resume: winner, duplicate: true };
    }
    return {
      ok: false,
      status: 500,
      code: "storage",
      message: "Could not save your resume. Please try again.",
    };
  }
}
