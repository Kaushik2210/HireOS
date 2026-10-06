export type SectionKey =
  | "summary"
  | "experience"
  | "leadership"
  | "education"
  | "projects"
  | "skills"
  | "certifications"
  | "achievements"
  | "other";

const HEADINGS: Record<SectionKey, string[]> = {
  summary: [
    "summary",
    "professional summary",
    "career summary",
    "profile",
    "professional profile",
    "career objective",
    "objective",
    "about me",
    "about",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "work history",
    "internships",
    "internship",
    "internship experience",
    "relevant experience",
    "industry experience",
  ],
  leadership: [
    "leadership",
    "leadership experience",
    "leadership and activities",
    "positions of responsibility",
    "extracurricular activities",
    "extracurriculars",
    "volunteer experience",
    "volunteering",
    "activities",
  ],
  education: [
    "education",
    "academic background",
    "academics",
    "academic qualifications",
    "educational qualifications",
    "education and training",
  ],
  projects: [
    "projects",
    "academic projects",
    "personal projects",
    "key projects",
    "selected projects",
    "technical projects",
    "project experience",
  ],
  skills: [
    "skills",
    "technical skills",
    "core competencies",
    "key skills",
    "skills and tools",
    "technologies",
    "tools and technologies",
    "technical proficiency",
    "technical expertise",
    "areas of expertise",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses and certifications",
    "certifications and courses",
    "courses",
    "training",
    "online courses",
    "courses and certifications",
  ],
  achievements: [
    "achievements",
    "awards",
    "honors",
    "honours",
    "accomplishments",
    "awards and achievements",
    "achievements and awards",
    "publications",
    "honors and awards",
    "scholarships",
  ],
  other: [
    "languages",
    "interests",
    "hobbies",
    "references",
    "declaration",
    "personal details",
    "personal information",
    "additional information",
  ],
};

const LOOKUP = new Map<string, SectionKey>();
for (const [key, names] of Object.entries(HEADINGS) as [SectionKey, string[]][]) {
  for (const name of names) LOOKUP.set(name, key);
}

/** "WORK EXPERIENCE:" and "Skills & Tools" both reduce to a comparable key. */
function headingKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the section a line introduces, or null when it is ordinary content. */
export function matchHeading(line: string): SectionKey | null {
  if (line.length === 0 || line.length > 45) return null;
  if (/^[•*-]\s/.test(line)) return null;
  return LOOKUP.get(headingKey(line)) ?? null;
}

export interface DetectedSection {
  key: SectionKey;
  /** The heading exactly as written. */
  heading: string;
  lines: string[];
}

export interface SectionSplit {
  /** Lines before the first heading: usually name and contact details. */
  header: string[];
  sections: DetectedSection[];
}

export function detectSections(lines: string[]): SectionSplit {
  const header: string[] = [];
  const sections: DetectedSection[] = [];
  let current: DetectedSection | null = null;

  for (const line of lines) {
    const key = matchHeading(line);
    if (key) {
      current = { key, heading: line, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  return { header, sections };
}

/** All lines of every section with this key, joined in document order. */
export function linesOf(split: SectionSplit, ...keys: SectionKey[]): string[] {
  return split.sections.filter((s) => keys.includes(s.key)).flatMap((s) => s.lines);
}
