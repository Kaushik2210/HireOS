import { z } from "zod";
import {
  achievementSchema,
  certificationSchema,
  educationSchema,
  experienceSchema,
  projectSchema,
  skillSchema,
} from "@/lib/profile/schemas";

const nullableText = z.string().max(500).nullable();

export const contactSchema = z.object({
  full_name: nullableText,
  email: nullableText,
  phone: nullableText,
  location: nullableText,
  linkedin_url: nullableText,
  github_url: nullableText,
  website_url: nullableText,
});

/**
 * What the parser found. Items reuse the real profile schemas, so anything stored here is
 * already valid profile data, and reading it back from the database re-validates it.
 */
export const parsedResumeSchema = z.object({
  contact: contactSchema,
  summary: z.string().max(1500).nullable(),
  sections: z.array(z.object({ key: z.string(), heading: z.string(), lineCount: z.number() })),
  education: z.array(educationSchema),
  experiences: z.array(experienceSchema),
  projects: z.array(projectSchema),
  certifications: z.array(certificationSchema),
  achievements: z.array(achievementSchema),
  skills: z.array(skillSchema),
  stats: z.object({
    characters: z.number(),
    words: z.number(),
    lines: z.number(),
    bullets: z.number(),
    pages: z.number(),
  }),
  /** Plain-language caveats shown to the user, such as "months were guessed from years". */
  notes: z.array(z.string()),
  /** Candidate items the parser found but could not turn into valid entries. */
  dropped: z.number(),
});

export const healthCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** 0 to 1 */
  progress: z.number().min(0).max(1),
  evidence: z.string(),
  hint: z.string(),
});

export const healthGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number(),
  /** 0 to 100 */
  score: z.number().min(0).max(100),
  checks: z.array(healthCheckSchema),
});

export const resumeHealthSchema = z.object({
  /** 0 to 100, weighted across groups. Describes the document, not hiring odds. */
  score: z.number().min(0).max(100),
  groups: z.array(healthGroupSchema),
});

export type ParsedResume = z.output<typeof parsedResumeSchema>;
export type ResumeHealth = z.output<typeof resumeHealthSchema>;
export type HealthGroup = z.output<typeof healthGroupSchema>;
export type HealthCheck = z.output<typeof healthCheckSchema>;
