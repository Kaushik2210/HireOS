import type { Claim, Entry, ResumeDoc } from "@/lib/tailoring/types";

function entryLines(entry: Entry): string[] {
  const lines = [entry.heading.text];
  if (entry.detail) lines.push(entry.detail.text);
  for (const b of entry.bullets) lines.push(`- ${b.text}`);
  return lines;
}

function section(title: string, entries: Entry[]): string[] {
  if (entries.length === 0) return [];
  return [
    "",
    title,
    ...entries.flatMap((e, i) => (i === 0 ? entryLines(e) : ["", ...entryLines(e)])),
  ];
}

/** One line per displayed line, so two versions can be compared line by line. */
export function resumeLines(doc: ResumeDoc): string[] {
  const lines: string[] = [doc.header.name.text];
  if (doc.header.headline) lines.push(doc.header.headline.text);
  if (doc.header.details.length > 0) lines.push(doc.header.details.map((d) => d.text).join(" · "));
  if (doc.summary) lines.push("", "SUMMARY", doc.summary.text);
  if (doc.skills.length > 0) lines.push("", "SKILLS", doc.skills.map((s) => s.text).join(", "));
  lines.push(
    ...section("EXPERIENCE", doc.experience),
    ...section("PROJECTS", doc.projects),
    ...section("EDUCATION", doc.education),
    ...section("CERTIFICATIONS", doc.certifications),
    ...section("ACHIEVEMENTS", doc.achievements),
  );
  return lines;
}

export const renderResumeText = (doc: ResumeDoc): string => resumeLines(doc).join("\n");

export const allResumeClaims = (doc: ResumeDoc): Claim[] => [
  doc.header.name,
  ...(doc.header.headline ? [doc.header.headline] : []),
  ...doc.header.details,
  ...(doc.summary ? [doc.summary] : []),
  ...doc.skills,
  ...[doc.experience, doc.projects, doc.education, doc.certifications, doc.achievements].flatMap(
    (entries) => entries.flatMap((e) => [e.heading, ...(e.detail ? [e.detail] : []), ...e.bullets]),
  ),
];
