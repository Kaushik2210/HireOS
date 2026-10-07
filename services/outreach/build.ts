import type { ProfileSnapshot } from "@/db/profile/store";
import type { Job } from "@/lib/jobs/schemas";
import {
  LINKEDIN_NOTE_LIMIT,
  OUTREACH_META,
  type OutreachDoc,
  type OutreachInput,
} from "@/lib/outreach/types";
import { TAILOR_VERSION, type Claim, type SourceRef } from "@/lib/tailoring/types";
import { verifiedSnapshot } from "@/services/profile/verified";
import { jobRef, pickEvidence, sentence } from "@/services/tailoring/evidence";

export type BuildFailure =
  "no_profile" | "nothing_verified" | "needs_context" | "needs_confirmation";

export type OutreachResult =
  { ok: true; doc: OutreachDoc; spans: string[] } | { ok: false; reason: BuildFailure };

/**
 * Builds a draft from fixed wording around verbatim pieces of the verified profile. It
 * never states anything the person has not confirmed: "I applied" and "we spoke" appear only
 * when they tick the matching box, and how they know someone appears only in their own words.
 */
export function buildOutreach(
  snapshot: ProfileSnapshot,
  job: Job,
  input: OutreachInput,
): OutreachResult {
  const v = verifiedSnapshot(snapshot);
  if (!v.profile) return { ok: false, reason: "no_profile" };
  if (v.skills.length + v.projects.length + v.experiences.length === 0) {
    return { ok: false, reason: "nothing_verified" };
  }
  const meta = OUTREACH_META[input.type];
  if (meta.needsContext && !input.shared_context) return { ok: false, reason: "needs_context" };
  if (meta.confirm === "applied" && !input.confirm_applied) {
    return { ok: false, reason: "needs_confirmation" };
  }
  if (meta.confirm === "spoken" && !input.confirm_spoken) {
    return { ok: false, reason: "needs_confirmation" };
  }

  const profile = v.profile;
  const name = input.recipient_name;
  const nameRef: SourceRef[] = [{ entity: "profiles", id: profile.id, fields: ["full_name"] }];
  const userRef = (field: string): SourceRef => ({
    entity: "user_input",
    id: field,
    fields: [field],
  });
  const forJob = (fields: string[]) => jobRef(job, fields);
  const role = `the ${job.title} role at ${job.company_name}`;
  const ev = pickEvidence(v, job, "The skills in your posting that I have worked with include");
  const intro = profile.headline ? `${profile.full_name}, ${profile.headline}` : profile.full_name;
  const introRefs: SourceRef[] = [
    {
      entity: "profiles",
      id: profile.id,
      fields: profile.headline ? ["full_name", "headline"] : ["full_name"],
    },
  ];
  const greeting = (id = "greeting") =>
    sentence(
      id,
      name ? `Dear ${name},` : "Hello,",
      name ? [userRef("recipient_name")] : [forJob(["company_name"])],
    );
  const signoff = (word: string) => sentence("signoff", `${word}\n${profile.full_name}`, nameRef);
  const lines = (...claims: (Claim | null)[]) => claims.filter((c): c is Claim => c !== null);

  const paragraphs: Claim[][] = [];
  let subject: string | null = null;

  switch (input.type) {
    case "recruiter":
      subject = `Interested in ${role}`;
      paragraphs.push(
        [greeting()],
        [
          sentence("opening", `I am ${intro}. I am writing about ${role}.`, [
            ...introRefs,
            forJob(["title", "company_name"]),
          ]),
        ],
        lines(ev.project, ev.role, ev.skills),
        [
          sentence(
            "ask",
            "If it looks like a fit, could you tell me what the next steps would be?",
            [forJob(["title"])],
          ),
        ],
        [sentence("closing", "Thank you for your time.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;

    case "hiring_manager":
      subject = `Introduction: ${role}`;
      paragraphs.push(
        [greeting()],
        [
          sentence(
            "opening",
            `I am ${intro}. I am interested in ${role} and wanted to introduce myself.`,
            [...introRefs, forJob(["title", "company_name"])],
          ),
        ],
        lines(ev.project ?? ev.role, ev.skills),
        [
          sentence(
            "ask",
            "If you have a few minutes, I would welcome a short conversation about the team's work.",
            [forJob(["company_name"])],
          ),
        ],
        [sentence("closing", "Thank you for your time.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;

    case "referral":
      subject = `A question about ${role}`;
      paragraphs.push(
        [greeting()],
        [
          sentence("opening", `I am ${intro}. I am interested in ${role}.`, [
            ...introRefs,
            forJob(["title", "company_name"]),
          ]),
        ],
        ...(input.shared_context
          ? [[sentence("context", input.shared_context, [userRef("shared_context")])]]
          : []),
        lines(ev.project ?? ev.role, ev.skills),
        [
          sentence(
            "ask",
            "Would you be comfortable referring me, or pointing me to the right person? I understand if not.",
            [forJob(["company_name"])],
          ),
        ],
        [sentence("closing", "Thank you for considering it.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;

    case "alumni": {
      const school = [...v.education].sort((a, b) =>
        (b.end_date ?? "9999").localeCompare(a.end_date ?? "9999"),
      )[0];
      subject = `A question about ${job.company_name}`;
      paragraphs.push(
        [greeting()],
        [sentence("context", input.shared_context!, [userRef("shared_context")])],
        [
          sentence("opening", `I am ${intro}. I am interested in ${role}.`, [
            ...introRefs,
            forJob(["title", "company_name"]),
          ]),
        ],
        ...(school
          ? [
              [
                sentence("education", `I studied ${school.degree} at ${school.institution}.`, [
                  {
                    entity: "education",
                    id: school.id,
                    fields: ["degree", "institution"],
                  },
                ]),
              ],
            ]
          : []),
        lines(ev.project ?? ev.role),
        [
          sentence(
            "ask",
            `Would you be open to a short chat about your experience with ${job.company_name}?`,
            [forJob(["company_name"])],
          ),
        ],
        [sentence("closing", "Thank you for your time.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;
    }

    case "linkedin_note": {
      const hi = name ? `Hi ${name},` : "Hi,";
      const hiRef = name ? [userRef("recipient_name")] : [forJob(["company_name"])];
      const candidates: Claim[][] = [
        [
          sentence(
            "note",
            `${hi} I am ${intro}. I am interested in ${role} and would value connecting.`,
            [...hiRef, ...introRefs, forJob(["title", "company_name"])],
          ),
        ],
        [
          sentence(
            "note",
            `${hi} I am ${profile.full_name}. I am interested in ${role} and would value connecting.`,
            [...hiRef, ...nameRef, forJob(["title", "company_name"])],
          ),
        ],
        [
          sentence("note", `${hi} I would value connecting about ${role}.`, [
            ...hiRef,
            forJob(["title", "company_name"]),
          ]),
        ],
        [sentence("note", `${hi} I would value connecting.`, hiRef)],
      ];
      // The longest version that fits LinkedIn's limit; a bare greeting always does.
      const fit = candidates.find(
        (c) => c.map((x) => x.text).join(" ").length <= LINKEDIN_NOTE_LIMIT,
      ) ?? [sentence("note", "Hi, I would value connecting.", [forJob(["company_name"])])];
      paragraphs.push(fit);
      break;
    }

    case "follow_up":
      subject = `Following up: ${job.title} at ${job.company_name}`;
      paragraphs.push(
        [greeting()],
        [
          sentence("opening", `I applied for ${role} and wanted to follow up.`, [
            forJob(["title", "company_name"]),
            userRef("confirm_applied"),
          ]),
        ],
        lines(ev.project ?? ev.role, ev.skills),
        [
          sentence(
            "ask",
            "Could you let me know if there is any update, or anything else I can send you?",
            [forJob(["title"])],
          ),
        ],
        [sentence("closing", "Thank you for your time.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;

    case "thank_you":
      subject = `Thank you: ${job.title} at ${job.company_name}`;
      paragraphs.push(
        [greeting()],
        [
          sentence("opening", `Thank you for taking the time to speak with me about ${role}.`, [
            forJob(["title", "company_name"]),
            userRef("confirm_spoken"),
          ]),
        ],
        [sentence("interest", "I remain interested in the role.", [forJob(["title"])])],
        lines(ev.skills),
        [sentence("closing", "Thank you again for your time.", [forJob(["company_name"])])],
        [signoff("Best regards,")],
      );
      break;
  }

  const body = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => p.map((c) => c.text).join(" "))
    .join("\n\n");
  const channel = meta.channel;
  return {
    ok: true,
    spans: [name, input.recipient_title].filter((s): s is string => Boolean(s)),
    doc: {
      tailor_version: TAILOR_VERSION,
      channel,
      subject: channel === "email" ? subject : null,
      paragraphs: paragraphs.filter((p) => p.length > 0),
      text: body,
      edited: false,
    },
  };
}
