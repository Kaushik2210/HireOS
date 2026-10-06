import { Badge } from "@/components/ui/badge";
import type { ParsedResume } from "@/lib/resume/schemas";

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  experience: "Experience",
  leadership: "Leadership",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  certifications: "Certifications",
  achievements: "Achievements",
  other: "Other",
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">
        {value ?? <span className="text-subtle">Not found</span>}
      </dd>
    </div>
  );
}

export function ParsedPreview({ parsed, text }: { parsed: ParsedResume; text: string }) {
  const counts: [string, number][] = [
    ["Experience", parsed.experiences.length],
    ["Projects", parsed.projects.length],
    ["Education", parsed.education.length],
    ["Skills", parsed.skills.length],
    ["Certifications", parsed.certifications.length],
    ["Achievements", parsed.achievements.length],
  ];

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="found-heading">
        <h3 id="found-heading" className="mb-3 text-sm font-semibold">
          What we found
        </h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {counts.map(([label, n]) => (
            <li key={label} className="border-border bg-surface-raised rounded-md border px-3 py-2">
              <p className="text-xl font-semibold tabular-nums">{n}</p>
              <p className="text-subtle text-xs">{label}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contact-heading">
        <h3 id="contact-heading" className="mb-3 text-sm font-semibold">
          Contact details read
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" value={parsed.contact.full_name} />
          <Field label="Email" value={parsed.contact.email} />
          <Field label="Phone" value={parsed.contact.phone} />
          <Field label="Location" value={parsed.contact.location} />
          <Field label="LinkedIn" value={parsed.contact.linkedin_url} />
          <Field label="GitHub" value={parsed.contact.github_url} />
        </dl>
      </section>

      <section aria-labelledby="sections-heading">
        <h3 id="sections-heading" className="mb-2 text-sm font-semibold">
          Sections detected
        </h3>
        {parsed.sections.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {parsed.sections.map((s, i) => (
              <li key={`${s.key}-${i}`}>
                <Badge variant="neutral" title={`Heading: ${s.heading}`}>
                  {SECTION_LABELS[s.key] ?? s.key}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">No standard section headings were found.</p>
        )}
      </section>

      {parsed.notes.length > 0 && (
        <section aria-labelledby="notes-heading">
          <h3 id="notes-heading" className="mb-2 text-sm font-semibold">
            Worth checking
          </h3>
          <ul className="text-muted list-disc space-y-1 pl-5 text-sm">
            {parsed.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <details className="border-border bg-surface-raised rounded-md border">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
          What an applicant tracking system reads
        </summary>
        <div className="border-border border-t p-3">
          <p className="text-subtle mb-2 text-xs">
            The plain text extracted from your file, with layout removed. If something important is
            missing or jumbled here, a tracking system will likely miss it too.
          </p>
          <pre className="bg-background max-h-80 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {text.slice(0, 6000) || "No text could be extracted."}
            {text.length > 6000 ? "\n\n…" : ""}
          </pre>
        </div>
      </details>
    </div>
  );
}
