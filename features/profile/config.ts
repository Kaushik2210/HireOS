import {
  ACHIEVEMENT_CATEGORIES,
  EXPERIENCE_KINDS,
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  SALARY_PERIODS,
  SKILL_LEVELS,
  SKILL_TYPES,
  SKILL_TYPE_LABELS,
  WORK_MODES,
} from "@/lib/profile/constants";
import { formatMonth, formatRange, label } from "@/features/profile/format";
import {
  careerGoalSchema,
  collectionSchemas,
  profileSchema,
  type CollectionEntity,
  type CollectionItem,
} from "@/lib/profile/schemas";
import type { z } from "zod";
import type { FieldDef } from "@/components/forms/field-types";

const options = (values: readonly string[], labels?: Record<string, string>) =>
  values.map((value) => ({ value, label: labels?.[value] ?? label(value) }));

export interface ItemSummary {
  title: string;
  subtitle?: string;
  meta?: string;
  description?: string;
  bullets?: string[];
  chips?: string[];
  link?: { href: string; label: string };
}

export interface SectionConfig<E extends CollectionEntity = CollectionEntity> {
  entity: E;
  title: string;
  singular: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  schema: z.ZodType;
  fields: FieldDef[];
  /** Initial values for a new item. */
  defaults: Record<string, unknown>;
  summarize: (item: CollectionItem<E>) => ItemSummary;
}

const dateFields = (startLabel = "Start", endLabel = "End"): FieldDef[] => [
  { kind: "month", name: "start_date", label: startLabel, placeholder: "YYYY-MM" },
  { kind: "month", name: "end_date", label: endLabel, placeholder: "YYYY-MM" },
  { kind: "checkbox", name: "is_current", label: "This is ongoing" },
];

const BULLETS_HINT =
  "One per line. Say what you did and the result. Only include things that are true.";

export const SECTIONS: { [E in CollectionEntity]: SectionConfig<E> } = {
  education: {
    entity: "education",
    title: "Education",
    singular: "education entry",
    description: "Degrees and courses you have completed or are pursuing.",
    emptyTitle: "No education added",
    emptyDescription: "Add your degree or most recent course of study.",
    schema: collectionSchemas.education,
    fields: [
      { kind: "text", name: "institution", label: "Institution" },
      {
        kind: "text",
        name: "degree",
        label: "Degree",
        placeholder: "Master of Computer Applications",
      },
      { kind: "text", name: "field_of_study", label: "Field of study" },
      ...dateFields(),
      { kind: "text", name: "grade", label: "Grade", placeholder: "CGPA 8.4 / 10" },
      { kind: "list", mode: "lines", name: "highlights", label: "Highlights", hint: BULLETS_HINT },
    ],
    defaults: { is_current: false, highlights: [] },
    summarize: (i) => ({
      title: i.degree,
      subtitle: [i.institution, i.field_of_study].filter(Boolean).join(" · "),
      meta: [formatRange(i.start_date, i.end_date, i.is_current), i.grade]
        .filter(Boolean)
        .join(" · "),
      bullets: i.highlights,
    }),
  },
  experiences: {
    entity: "experiences",
    title: "Experience",
    singular: "experience",
    description: "Jobs, internships, leadership and volunteer roles.",
    emptyTitle: "No experience added",
    emptyDescription:
      "Add an internship, job, leadership or volunteer role. Projects can stand in until you have one.",
    schema: collectionSchemas.experiences,
    fields: [
      { kind: "select", name: "kind", label: "Type", options: options(EXPERIENCE_KINDS) },
      { kind: "text", name: "organization", label: "Organization" },
      { kind: "text", name: "title", label: "Title" },
      { kind: "text", name: "location", label: "Location" },
      ...dateFields(),
      {
        kind: "list",
        mode: "lines",
        name: "highlights",
        label: "What you did",
        hint: BULLETS_HINT,
      },
      {
        kind: "list",
        mode: "commas",
        name: "skills",
        label: "Skills used",
        hint: "Comma separated.",
      },
    ],
    defaults: { kind: "work", is_current: false, highlights: [], skills: [] },
    summarize: (i) => ({
      title: i.title,
      subtitle: [i.organization, i.location].filter(Boolean).join(" · "),
      meta: [label(i.kind), formatRange(i.start_date, i.end_date, i.is_current)]
        .filter(Boolean)
        .join(" · "),
      bullets: i.highlights,
      chips: i.skills,
    }),
  },
  projects: {
    entity: "projects",
    title: "Projects",
    singular: "project",
    description: "Things you built. Recruiters read these closely, so be specific.",
    emptyTitle: "No projects added",
    emptyDescription: "Add at least two projects that show what you can build.",
    schema: collectionSchemas.projects,
    fields: [
      { kind: "text", name: "name", label: "Project name" },
      { kind: "text", name: "role", label: "Your role", placeholder: "Solo developer" },
      { kind: "textarea", name: "description", label: "Description", rows: 3 },
      { kind: "url", name: "url", label: "Live link", placeholder: "https://" },
      {
        kind: "url",
        name: "repo_url",
        label: "Repository link",
        placeholder: "https://github.com/...",
      },
      ...dateFields(),
      {
        kind: "list",
        mode: "commas",
        name: "tech",
        label: "Technologies",
        hint: "Comma separated.",
      },
      { kind: "list", mode: "lines", name: "highlights", label: "Highlights", hint: BULLETS_HINT },
    ],
    defaults: { is_current: false, tech: [], highlights: [] },
    summarize: (i) => ({
      title: i.name,
      subtitle: i.role ?? undefined,
      meta: formatRange(i.start_date, i.end_date, i.is_current),
      description: i.description ?? undefined,
      bullets: i.highlights,
      chips: i.tech,
      link: i.repo_url
        ? { href: i.repo_url, label: "Repository" }
        : i.url
          ? { href: i.url, label: "Live site" }
          : undefined,
    }),
  },
  certifications: {
    entity: "certifications",
    title: "Certifications",
    singular: "certification",
    description: "Certificates and completed courses. Optional.",
    emptyTitle: "No certifications added",
    emptyDescription: "Add a certification if you have one. It is fine to skip this.",
    schema: collectionSchemas.certifications,
    fields: [
      { kind: "text", name: "name", label: "Name" },
      { kind: "text", name: "issuer", label: "Issuer" },
      { kind: "month", name: "issued_date", label: "Issued", placeholder: "YYYY-MM" },
      { kind: "month", name: "expires_date", label: "Expires", placeholder: "YYYY-MM" },
      { kind: "text", name: "credential_id", label: "Credential ID" },
      { kind: "url", name: "url", label: "Verification link", placeholder: "https://" },
    ],
    defaults: {},
    summarize: (i) => ({
      title: i.name,
      subtitle: i.issuer ?? undefined,
      meta: [
        i.issued_date ? `Issued ${formatMonth(i.issued_date)}` : "",
        i.expires_date ? `Expires ${formatMonth(i.expires_date)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      link: i.url ? { href: i.url, label: "Verify" } : undefined,
    }),
  },
  skills: {
    entity: "skills",
    title: "Skills",
    singular: "skill",
    description:
      "Only list skills you can genuinely back up. Recognised names are standardised, so js becomes JavaScript.",
    emptyTitle: "No skills added",
    emptyDescription: "Add at least eight skills across a few categories.",
    schema: collectionSchemas.skills,
    fields: [
      { kind: "text", name: "name", label: "Skill", placeholder: "e.g. PostgreSQL" },
      {
        kind: "select",
        name: "type",
        label: "Category",
        options: options(SKILL_TYPES, SKILL_TYPE_LABELS),
      },
      { kind: "select", name: "level", label: "Level", options: options(SKILL_LEVELS) },
      { kind: "number", name: "years", label: "Years of experience", hint: "Optional." },
    ],
    defaults: { type: "language", level: "intermediate", years: null },
    summarize: (i) => ({
      title: i.name,
      meta: [label(i.level), i.years !== null ? `${i.years} yr` : ""].filter(Boolean).join(" · "),
    }),
  },
  achievements: {
    entity: "achievements",
    title: "Achievements",
    singular: "achievement",
    description: "Awards, competitions and publications.",
    emptyTitle: "No achievements added",
    emptyDescription: "Add an award, competition result or publication. Optional.",
    schema: collectionSchemas.achievements,
    fields: [
      { kind: "text", name: "title", label: "Title" },
      { kind: "select", name: "category", label: "Type", options: options(ACHIEVEMENT_CATEGORIES) },
      { kind: "month", name: "achieved_on", label: "When", placeholder: "YYYY-MM" },
      { kind: "textarea", name: "description", label: "Details", rows: 3 },
    ],
    defaults: { category: "award" },
    summarize: (i) => ({
      title: i.title,
      meta: [label(i.category), formatMonth(i.achieved_on)].filter(Boolean).join(" · "),
      description: i.description ?? undefined,
    }),
  },
};

export const SECTION_ORDER: CollectionEntity[] = [
  "experiences",
  "projects",
  "skills",
  "education",
  "certifications",
  "achievements",
];

/* ---------- singletons ---------- */

export interface SingletonConfig {
  title: string;
  schema: z.ZodType;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
}

const LEVEL_OPTIONS = options(EXPERIENCE_LEVELS);

export const PROFILE_FORM: SingletonConfig = {
  title: "Edit profile",
  schema: profileSchema,
  defaults: {
    work_modes: [],
    job_types: [],
    preferred_locations: [],
    open_to_relocate: false,
    salary_currency: "INR",
    salary_period: "year",
  },
  fields: [
    { kind: "text", name: "full_name", label: "Full name" },
    { kind: "text", name: "headline", label: "Headline", placeholder: "What you do, in one line" },
    {
      kind: "textarea",
      name: "summary",
      label: "Summary",
      rows: 4,
      hint: "Two or three sentences. At least 80 characters.",
    },
    { kind: "text", name: "location", label: "Location" },
    {
      kind: "url",
      name: "linkedin_url",
      label: "LinkedIn",
      placeholder: "https://www.linkedin.com/in/...",
    },
    { kind: "url", name: "github_url", label: "GitHub", placeholder: "https://github.com/..." },
    { kind: "url", name: "website_url", label: "Website", placeholder: "https://" },
    {
      kind: "select",
      name: "experience_level",
      label: "Experience level",
      options: LEVEL_OPTIONS,
      allowEmpty: true,
    },
    { kind: "checkboxes", name: "work_modes", label: "Work mode", options: options(WORK_MODES) },
    { kind: "checkboxes", name: "job_types", label: "Job types", options: options(JOB_TYPES) },
    {
      kind: "list",
      mode: "commas",
      name: "preferred_locations",
      label: "Preferred locations",
      hint: "Comma separated.",
    },
    { kind: "checkbox", name: "open_to_relocate", label: "Open to relocating" },
    { kind: "number", name: "expected_salary_min", label: "Expected salary, minimum" },
    { kind: "number", name: "expected_salary_max", label: "Expected salary, maximum" },
    { kind: "text", name: "salary_currency", label: "Currency", placeholder: "INR" },
    { kind: "select", name: "salary_period", label: "Per", options: options(SALARY_PERIODS) },
  ],
};

export const GOALS_FORM: SingletonConfig = {
  title: "Edit career goal",
  schema: careerGoalSchema,
  defaults: { target_roles: [] },
  fields: [
    {
      kind: "list",
      mode: "commas",
      name: "target_roles",
      label: "Target roles",
      hint: "Up to five, comma separated. The first is your main target.",
    },
    {
      kind: "select",
      name: "target_level",
      label: "Target level",
      options: LEVEL_OPTIONS,
      allowEmpty: true,
    },
    {
      kind: "number",
      name: "timeline_months",
      label: "Timeline in months",
      hint: "How soon you want to be hired.",
    },
    { kind: "textarea", name: "statement", label: "In your own words", rows: 3 },
  ],
};
