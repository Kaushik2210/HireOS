import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { LINKEDIN_NOTE_LIMIT, type OutreachDoc } from "@/lib/outreach/types";
import type { BlockedClaim, Verification } from "@/lib/tailoring/types";
import { verifyLetter, verifyLetterText } from "@/services/tailoring/verify";

/**
 * Checks an outreach draft, generated or edited, the way a cover letter is checked: every
 * generated line traces to a verified item or to the posting, and the final subject and body
 * name only skills and numbers that exist in the verified profile. A recipient's name and
 * title are accepted as typed because they describe the other person, not the sender.
 */
export function verifyOutreach(
  doc: OutreachDoc,
  snapshot: ProfileSnapshot,
  job: Job,
  spans: string[] = [],
): Verification {
  const body = verifyLetter(doc, snapshot, job, spans);
  const blocked: BlockedClaim[] = [...body.blocked];
  let checked = body.checked;

  if (doc.subject) {
    const subject = verifyLetterText(doc.subject, snapshot, job, spans);
    checked += subject.checked;
    blocked.push(...subject.blocked.map((b) => ({ ...b, claim_id: `subject:${b.claim_id}` })));
  }
  if (doc.channel === "linkedin" && doc.text.length > LINKEDIN_NOTE_LIMIT) {
    blocked.push({
      claim_id: "length",
      text: `${doc.text.slice(0, 60)}...`,
      reason: `A LinkedIn connection note can be at most ${LINKEDIN_NOTE_LIMIT} characters; this is ${doc.text.length}.`,
    });
  }
  return { ok: blocked.length === 0, checked, blocked };
}
