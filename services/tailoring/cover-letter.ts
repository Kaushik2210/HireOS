import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import { TAILOR_VERSION, type Claim, type LetterDoc } from "@/lib/tailoring/types";
import { verifiedSnapshot } from "@/services/profile/verified";
import { jobRef, pickEvidence, sentence } from "@/services/tailoring/evidence";

export type LetterResult =
  | { ok: true; doc: LetterDoc; skillsUsed: string[] }
  | { ok: false; reason: "no_profile" | "nothing_verified" };

/**
 * A short cover letter built from sentences with fixed wording around verbatim pieces of
 * the verified profile. It never mentions a skill the person lacks, and never claims
 * enthusiasm, years or results that the profile does not contain.
 */
export function buildCoverLetter(snapshot: ProfileSnapshot, job: Job): LetterResult {
  const v = verifiedSnapshot(snapshot);
  if (!v.profile) return { ok: false, reason: "no_profile" };
  if (v.skills.length + v.projects.length + v.experiences.length === 0) {
    return { ok: false, reason: "nothing_verified" };
  }

  const paragraphs: Claim[][] = [];
  paragraphs.push([sentence("greeting", "Dear Hiring Team,", [jobRef(job, ["company_name"])])]);
  paragraphs.push([
    sentence("opening", `I am writing to apply for the ${job.title} role at ${job.company_name}.`, [
      jobRef(job, ["title", "company_name"]),
    ]),
  ]);

  const evidence = pickEvidence(
    v,
    job,
    "The skills in your posting that I have worked with include",
  );
  const lines = [evidence.project, evidence.role].filter((c): c is Claim => c !== null);
  if (lines.length > 0) paragraphs.push(lines);
  if (evidence.skills) paragraphs.push([evidence.skills]);

  paragraphs.push([
    sentence("closing", "Thank you for your time and consideration.", [
      jobRef(job, ["company_name"]),
    ]),
  ]);
  paragraphs.push([
    sentence("signoff", `Sincerely,\n${v.profile.full_name}`, [
      { entity: "profiles", id: v.profile.id, fields: ["full_name"] },
    ]),
  ]);

  const text = paragraphs.map((p) => p.map((c) => c.text).join(" ")).join("\n\n");
  return {
    ok: true,
    doc: { tailor_version: TAILOR_VERSION, paragraphs, text, edited: false },
    skillsUsed: evidence.owned.map((o) => o.name),
  };
}
