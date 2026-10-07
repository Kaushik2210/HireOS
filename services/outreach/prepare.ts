import type { DraftEdit, NewDraft, OutreachDraft } from "@/db/outreach/store";
import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { MAX_BODY, MAX_SUBJECT, type OutreachInput } from "@/lib/outreach/types";
import { buildCandidate } from "@/services/matching/candidate";
import { buildOutreach, type BuildFailure } from "@/services/outreach/build";
import { verifyOutreach } from "@/services/outreach/verify";

export type PrepareFailure = BuildFailure | "empty" | "too_long" | "bad_subject";

const profileHash = (snapshot: ProfileSnapshot) => buildCandidate(snapshot).hash;

/** Builds a new draft from stored data. Nothing from the browser becomes draft content. */
export function prepareDraft(
  snapshot: ProfileSnapshot,
  job: Job,
  input: OutreachInput,
): { ok: true; draft: NewDraft } | { ok: false; reason: PrepareFailure } {
  const built = buildOutreach(snapshot, job, input);
  if (!built.ok) return built;
  return {
    ok: true,
    draft: {
      jobId: job.id,
      type: input.type,
      recipientName: input.recipient_name,
      recipientTitle: input.recipient_title,
      sharedContext: input.shared_context,
      doc: built.doc,
      verification: verifyOutreach(built.doc, snapshot, job, built.spans),
      profileHash: profileHash(snapshot),
    },
  };
}

/**
 * Applies the user's own edits to a draft and re-checks the result against the verified
 * profile. A LinkedIn note has no subject; an email always keeps one.
 */
export function prepareEdit(
  snapshot: ProfileSnapshot,
  job: Job,
  draft: OutreachDraft,
  edit: { text: string; subject?: string | null },
): { ok: true; edit: DraftEdit } | { ok: false; reason: PrepareFailure } {
  // eslint-disable-next-line no-control-regex
  const clean = (s: string) =>
    s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  const text = clean(edit.text).trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > MAX_BODY) return { ok: false, reason: "too_long" };

  let subject = draft.doc.subject;
  if (draft.channel === "email" && edit.subject !== undefined) {
    const s = clean(edit.subject ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length === 0 || s.length > MAX_SUBJECT) return { ok: false, reason: "bad_subject" };
    subject = s;
  }

  const changed = text !== draft.doc.text || subject !== draft.doc.subject;
  const doc = { ...draft.doc, text, subject, edited: draft.doc.edited || changed };
  const spans = [draft.recipientName, draft.recipientTitle].filter((s): s is string => Boolean(s));
  return {
    ok: true,
    edit: {
      doc,
      verification: verifyOutreach(doc, snapshot, job, spans),
      profileHash: profileHash(snapshot),
    },
  };
}
