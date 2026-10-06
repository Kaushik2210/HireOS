/** Largest accepted upload. Kept under common serverless request limits (4.5 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_RESUMES_PER_USER = 10;

/** Parser budgets: bound CPU and memory for any single file. */
export const MAX_PDF_PAGES = 10;
export const MAX_TEXT_CHARS = 100_000;
export const PARSE_TIMEOUT_MS = 15_000;

/** DOCX is a ZIP, so guard against decompression bombs before reading anything. */
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 12 * 1024 * 1024;
export const MAX_ZIP_RATIO = 200;

export const ALLOWED_EXTENSIONS = ["pdf", "docx"] as const;
export type ResumeKind = (typeof ALLOWED_EXTENSIONS)[number];

export const CONTENT_TYPES: Record<ResumeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const STORAGE_BUCKET = "resumes";
/** How long a download link stays valid. */
export const SIGNED_URL_SECONDS = 60;
