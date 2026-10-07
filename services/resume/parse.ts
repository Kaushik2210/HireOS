import type { z } from "zod";
import {
  achievementSchema,
  certificationSchema,
  educationSchema,
  experienceSchema,
  projectSchema,
  skillSchema,
} from "@/lib/profile/schemas";
import type { ParsedResume } from "@/lib/resume/schemas";
import { clip } from "@/services/resume/blocks";
import {
  extractAchievements,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractProjects,
  type EntryContext,
} from "@/services/resume/extract-entries";
import { extractContact } from "@/services/resume/extract-contact";
import { extractSkills } from "@/services/resume/extract-skills";
import { normalizeText } from "@/lib/text/normalize";
import { detectSections, linesOf } from "@/services/resume/sections";

export interface ParseInput {
  rawText: string;
  pages: number;
  /** Caveats from text extraction, such as "email only in the page header". */
  extractionWarnings?: string[];
}

export interface ParseOutput {
  /** Normalized text: what later stages (and the "what an ATS sees" view) work from. */
  text: string;
  parsed: ParsedResume;
}

/** Keeps the valid drafts and counts the rest, so one bad entry never sinks the whole parse. */
function keepValid<S extends z.ZodType>(
  schema: S,
  drafts: unknown[],
  counter: { dropped: number },
) {
  const valid: z.output<S>[] = [];
  for (const draft of drafts) {
    const result = schema.safeParse(draft);
    if (result.success) valid.push(result.data);
    else counter.dropped += 1;
  }
  return valid;
}

/**
 * Turns resume text into structured, schema-valid profile drafts. Fully deterministic:
 * the same text always yields the same result, and nothing is invented. Anything the
 * parser is unsure about is dropped or flagged in `notes` for the user to review.
 */
export function parseResumeText(input: ParseInput): ParseOutput {
  const text = normalizeText(input.rawText);
  const lines = text.split("\n");
  const split = detectSections(lines);
  const counter = { dropped: 0 };
  const ctx: EntryContext = { yearOnlyDates: false };
  const notes: string[] = [...(input.extractionWarnings ?? [])];

  const contact = extractContact(split.header, text);

  const summaryLines = linesOf(split, "summary").filter(Boolean);
  const summary = summaryLines.length > 0 ? clip(summaryLines.join(" "), 1500) : null;

  const experienceLines = linesOf(split, "experience");
  const leadershipLines = linesOf(split, "leadership");
  const projectLines = linesOf(split, "projects");

  const skills = extractSkills(
    linesOf(split, "skills"),
    [...experienceLines, ...leadershipLines, ...projectLines].join("\n"),
  );

  const education = keepValid(
    educationSchema,
    extractEducation(linesOf(split, "education"), ctx),
    counter,
  );
  const experiences = keepValid(
    experienceSchema,
    [
      ...extractExperience(experienceLines, "experience", ctx),
      ...extractExperience(leadershipLines, "leadership", ctx),
    ],
    counter,
  );
  const projects = keepValid(projectSchema, extractProjects(projectLines, ctx), counter);
  const certifications = keepValid(
    certificationSchema,
    extractCertifications(linesOf(split, "certifications"), ctx),
    counter,
  );
  const achievements = keepValid(
    achievementSchema,
    extractAchievements(linesOf(split, "achievements"), ctx),
    counter,
  );
  const skillItems = keepValid(skillSchema, skills.drafts, counter);

  if (ctx.yearOnlyDates) {
    notes.push("Some dates only gave a year. Check the months before confirming those entries.");
  }
  if (counter.dropped > 0) {
    notes.push(
      `${counter.dropped} possible ${counter.dropped === 1 ? "entry" : "entries"} could not be read reliably and ${counter.dropped === 1 ? "was" : "were"} skipped. Add ${counter.dropped === 1 ? "it" : "them"} by hand if needed.`,
    );
  }
  if (split.sections.length === 0) {
    notes.push(
      "No standard section headings (Experience, Education, Skills) were found, so little could be extracted.",
    );
  }

  const nonEmpty = lines.filter(Boolean);
  const parsed: ParsedResume = {
    contact,
    summary,
    sections: split.sections.map((s) => ({
      key: s.key,
      heading: s.heading,
      lineCount: s.lines.filter(Boolean).length,
    })),
    education,
    experiences,
    projects,
    certifications,
    achievements,
    skills: skillItems,
    stats: {
      characters: text.length,
      words: text ? text.split(/\s+/).length : 0,
      lines: nonEmpty.length,
      bullets: nonEmpty.filter((l) => l.startsWith("• ")).length,
      pages: input.pages,
    },
    notes,
    dropped: counter.dropped,
  };
  return { text, parsed };
}
