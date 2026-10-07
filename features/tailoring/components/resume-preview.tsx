import type { Entry, ResumeDoc } from "@/lib/tailoring/types";

function Block({ title, entries }: { title: string; entries: Entry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="border-border text-subtle mb-2 border-b pb-1 font-mono text-[10px] tracking-wide uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">
        {entries.map((e) => (
          <div key={e.ref.id}>
            <p className="text-sm font-semibold break-words">{e.heading.text}</p>
            {e.detail && <p className="text-muted text-xs break-words">{e.detail.text}</p>}
            {e.bullets.length > 0 && (
              <ul className="text-muted mt-1 list-disc space-y-1 pl-5 text-sm">
                {e.bullets.map((b) => (
                  <li key={b.id} className="break-words">
                    {b.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The resume as plain text in a page-like card. Everything shown is a stored profile line. */
export function ResumePreview({ doc }: { doc: ResumeDoc }) {
  return (
    <article
      aria-label="Resume preview"
      className="border-border bg-surface flex flex-col gap-5 rounded-lg border p-5"
      data-testid="resume-preview"
    >
      <header>
        <h2 className="text-lg font-semibold break-words">{doc.header.name.text}</h2>
        {doc.header.headline && (
          <p className="text-muted text-sm break-words">{doc.header.headline.text}</p>
        )}
        {doc.header.details.length > 0 && (
          <p className="text-subtle mt-1 text-xs break-words">
            {doc.header.details.map((d) => d.text).join(" · ")}
          </p>
        )}
      </header>
      {doc.summary && (
        <section aria-label="Summary">
          <h3 className="border-border text-subtle mb-2 border-b pb-1 font-mono text-[10px] tracking-wide uppercase">
            Summary
          </h3>
          <p className="text-muted text-sm break-words">{doc.summary.text}</p>
        </section>
      )}
      {doc.skills.length > 0 && (
        <section aria-label="Skills">
          <h3 className="border-border text-subtle mb-2 border-b pb-1 font-mono text-[10px] tracking-wide uppercase">
            Skills
          </h3>
          <ul className="flex flex-wrap gap-1.5" data-testid="resume-skills">
            {doc.skills.map((s) => (
              <li key={s.id} className="border-border-strong rounded border px-2 py-0.5 text-xs">
                {s.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Block title="Experience" entries={doc.experience} />
      <Block title="Projects" entries={doc.projects} />
      <Block title="Education" entries={doc.education} />
      <Block title="Certifications" entries={doc.certifications} />
      <Block title="Achievements" entries={doc.achievements} />
    </article>
  );
}
