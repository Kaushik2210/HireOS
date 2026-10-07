import { z } from "zod";
import type { FieldDef } from "@/components/forms/field-types";
import { JOB_TYPES, MAX_JOB_DESCRIPTION, WORK_MODES } from "@/lib/jobs/constants";
import { requiredText, text, url } from "@/lib/schema-helpers";

const LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  full_time: "Full-time",
  internship: "Internship",
  contract: "Contract",
  part_time: "Part-time",
};

const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: LABELS[value] ?? value }));

/**
 * What a person types when they add a job by hand. Everything else (skills, requirements,
 * seniority, salary) is read from the pasted description by the analyser.
 */
export const manualJobFormSchema = z.object({
  company_name: requiredText("the company name", 150),
  title: requiredText("the job title", 200),
  location: text(150),
  work_mode: z
    .enum(WORK_MODES)
    .nullish()
    .transform((v) => v ?? null),
  job_type: z
    .enum(JOB_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  apply_url: url,
  description: z
    .string()
    .trim()
    .min(30, "Paste the job description: at least a few sentences")
    .max(MAX_JOB_DESCRIPTION, `Use at most ${MAX_JOB_DESCRIPTION} characters`),
});

export const MANUAL_JOB_FIELDS: FieldDef[] = [
  { kind: "text", name: "company_name", label: "Company" },
  { kind: "text", name: "title", label: "Job title" },
  { kind: "text", name: "location", label: "Location", placeholder: "City, or Remote" },
  {
    kind: "select",
    name: "work_mode",
    label: "Work mode",
    options: options(WORK_MODES),
    allowEmpty: true,
  },
  {
    kind: "select",
    name: "job_type",
    label: "Job type",
    options: options(JOB_TYPES),
    allowEmpty: true,
  },
  { kind: "url", name: "apply_url", label: "Application link", placeholder: "https://" },
  {
    kind: "textarea",
    name: "description",
    label: "Job description",
    rows: 10,
    hint: "Paste the full posting. Requirements, skills and pay are read from it.",
  },
];

export const MANUAL_JOB_DEFAULTS = {
  company_name: "",
  title: "",
  location: "",
  work_mode: "",
  job_type: "",
  apply_url: "",
  description: "",
};
