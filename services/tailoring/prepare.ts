import type { NewVersion } from "@/db/documents/store";
import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { MAX_DOCUMENT_TEXT } from "@/lib/tailoring/types";
import { buildCandidate } from "@/services/matching/candidate";
import { buildCoverLetter } from "@/services/tailoring/cover-letter";
import { renderResumeText } from "@/services/tailoring/render";
import { buildResume } from "@/services/tailoring/resume";
import { verifyLetter, verifyResume } from "@/services/tailoring/verify";

export type Prepared =
  | { ok: true; input: NewVersion }
  | { ok: false; reason: "no_profile" | "nothing_verified" | "too_long" | "empty" };

const profileHash = (snapshot: ProfileSnapshot) => buildCandidate(snapshot).hash;

/**
 * Builds a resume version from the profile as it is now. The document is always generated
 * on the server from stored data: nothing the browser sends is trusted as content.
 */
export function prepareResumeVersion(
  snapshot: ProfileSnapshot,
  job: Job,
  options: { exclude?: ReadonlySet<string>; parentId?: string | null } = {},
): Prepared {
  const built = buildResume(snapshot, job, { exclude: options.exclude });
  if (!built.ok) return built;
  const body = renderResumeText(built.doc);
  if (body.length > MAX_DOCUMENT_TEXT) return { ok: false, reason: "too_long" };
  return {
    ok: true,
    input: {
      jobId: job.id,
      kind: "resume",
      parentId: options.parentId ?? null,
      content: { kind: "resume", doc: built.doc },
      changes: built.changes,
      missing: built.missing,
      verification: verifyResume(built.doc, snapshot),
      body,
      profileHash: profileHash(snapshot),
    },
  };
}

/**
 * Builds a cover letter version. With `text`, the user's edited wording replaces the
 * generated text; it is checked against the whole verified profile and saved as edited.
 */
export function prepareLetterVersion(
  snapshot: ProfileSnapshot,
  job: Job,
  options: { text?: string; parentId?: string | null } = {},
): Prepared {
  const built = buildCoverLetter(snapshot, job);
  if (!built.ok) return built;
  let doc = built.doc;
  if (options.text !== undefined) {
    const text = options.text.replace(/\r\n/g, "\n").trim();
    if (text.length === 0) return { ok: false, reason: "empty" };
    if (text.length > MAX_DOCUMENT_TEXT) return { ok: false, reason: "too_long" };
    if (text !== doc.text) doc = { ...doc, text, edited: true };
  }
  return {
    ok: true,
    input: {
      jobId: job.id,
      kind: "cover_letter",
      parentId: options.parentId ?? null,
      content: { kind: "cover_letter", doc },
      changes: [],
      missing: [],
      verification: verifyLetter(doc, snapshot, job),
      body: doc.text,
      profileHash: profileHash(snapshot),
    },
  };
}
