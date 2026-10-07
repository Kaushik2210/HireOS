import { CircleAlert, CircleCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Change, MissingRequirement, Verification } from "@/lib/tailoring/types";
import type { DiffLine } from "@/services/tailoring/diff";

const card = "border-border bg-surface rounded-lg border p-4";

export function VerificationNote({ verification }: { verification: Verification }) {
  if (verification.ok) {
    return (
      <div className={card} data-testid="verification">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="text-success size-4" aria-hidden="true" /> Integrity check passed
        </h3>
        <p className="text-muted mt-1 text-xs">
          All {verification.checked} lines were traced to items in your verified profile. Nothing
          was invented, reworded or added.
        </p>
      </div>
    );
  }
  return (
    <div className={`${card} border-danger/40`} role="alert" data-testid="verification">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldAlert className="text-danger size-4" aria-hidden="true" /> Integrity check found{" "}
        {verification.blocked.length} {verification.blocked.length === 1 ? "problem" : "problems"}
      </h3>
      <p className="text-muted mt-1 text-xs">
        These lines could not be traced to your verified profile, so this version cannot be
        approved. Remove them, or add the real experience to your profile first.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {verification.blocked.map((b) => (
          <li key={`${b.claim_id}-${b.reason}`} className="text-xs">
            <span className="block break-words">&ldquo;{b.text}&rdquo;</span>
            <span className="text-danger">{b.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChangesPanel({ changes }: { changes: Change[] }) {
  return (
    <section aria-labelledby="changes-heading" className={card}>
      <h3 id="changes-heading" className="mb-1 text-sm font-semibold">
        What changed, and why
      </h3>
      <p className="text-muted mb-3 text-xs">
        Compared with your full profile. Only selection and order change: wording never does.
      </p>
      {changes.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing needed changing: everything in your profile fits on the page in its usual order.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="changes">
          {changes.map((c, i) => (
            <li key={`${c.kind}-${c.subject}-${i}`} className="text-sm">
              <span className="text-subtle block font-mono text-[10px] tracking-wide uppercase">
                {c.section}
              </span>
              <span className="font-medium break-words">{c.subject}</span>
              <span className="text-muted block text-xs">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MissingPanel({ missing }: { missing: MissingRequirement[] }) {
  if (missing.length === 0) {
    return (
      <section className={card} aria-labelledby="missing-heading">
        <h3 id="missing-heading" className="flex items-center gap-2 text-sm font-semibold">
          <CircleCheck className="text-success size-4" aria-hidden="true" /> Requirements
        </h3>
        <p className="text-muted mt-1 text-xs">
          Every skill this job lists was found in your verified profile.
        </p>
      </section>
    );
  }
  return (
    <section className={card} aria-labelledby="missing-heading">
      <h3 id="missing-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <CircleAlert className="text-warning size-4" aria-hidden="true" /> Not on this resume
      </h3>
      <p className="text-muted mb-3 text-xs">
        These are asked for by the job but are not in your verified profile, so they were not added.
      </p>
      <ul className="flex flex-col gap-2" data-testid="missing">
        {missing.map((m) => (
          <li key={m.skill} className="text-sm break-words">
            {m.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

const DIFF_STYLE: Record<DiffLine["type"], string> = {
  same: "text-muted",
  added: "bg-success/10 text-success",
  removed: "bg-danger/10 text-danger line-through",
};
const DIFF_MARK: Record<DiffLine["type"], string> = { same: " ", added: "+", removed: "-" };

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <pre
      className="border-border bg-surface overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap"
      data-testid="diff"
      aria-label="Differences between versions"
    >
      {lines.map((l, i) => (
        <span key={i} className={`block ${DIFF_STYLE[l.type]}`}>
          <span aria-hidden="true">{DIFF_MARK[l.type]} </span>
          <span className="sr-only">
            {l.type === "added" ? "Added: " : l.type === "removed" ? "Removed: " : ""}
          </span>
          {l.text || " "}
        </span>
      ))}
    </pre>
  );
}
