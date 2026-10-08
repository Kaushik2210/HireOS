import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Rate } from "@/lib/analytics/types";
import type { GroupStat } from "@/services/analytics/breakdowns";
import type { Funnel } from "@/services/analytics/funnel";
import type { Finding, Insights } from "@/services/analytics/insights";
import type { Readiness } from "@/services/analytics/readiness";

const card = "border-border bg-surface rounded-lg border p-5";

/** "3 of 7 (43%)", with a reminder when the sample is too small to read much into. */
export function RateTile({ label, rate }: { label: string; rate: Rate }) {
  return (
    <div
      className="border-border bg-surface rounded-lg border p-3"
      data-testid={`rate-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="mt-1">
        <span className="text-xl font-semibold tabular-nums">
          {rate.n} of {rate.of}
        </span>
        {rate.pct !== null && <span className="text-muted ml-1.5 text-sm">({rate.pct}%)</span>}
        {rate.small && rate.of > 0 && (
          <span className="text-subtle mt-0.5 block text-xs">Small sample: read with care.</span>
        )}
      </dd>
    </div>
  );
}

export function FunnelChart({ funnel }: { funnel: Funnel }) {
  const max = Math.max(1, funnel.applied);
  return (
    <ol className="flex flex-col gap-2.5" data-testid="funnel">
      {funnel.stages.map((s) => (
        <li key={s.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{s.label}</span>
            <span className="text-muted font-mono text-xs tabular-nums">{s.reached}</span>
          </div>
          <div
            role="meter"
            aria-label={`${s.label}: ${s.reached} of ${funnel.applied} applications reached this stage`}
            aria-valuemin={0}
            aria-valuemax={funnel.applied}
            aria-valuenow={s.reached}
            className="bg-border mt-1 h-2 overflow-hidden rounded-full"
          >
            <div
              className="bg-accent h-full rounded-full"
              style={{ width: `${(s.reached / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function WeeklyBars({ weekly }: { weekly: Funnel["weekly"] }) {
  const max = Math.max(1, ...weekly.map((w) => w.applied));
  return (
    <ul
      className="flex h-28 items-end gap-2"
      data-testid="weekly"
      aria-label="Applications per week"
    >
      {weekly.map((w) => (
        <li key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-muted font-mono text-[10px] tabular-nums">{w.applied}</span>
          <div
            className="bg-accent w-full rounded-t"
            style={{
              height: `${Math.max(2, (w.applied / max) * 72)}px`,
              opacity: w.applied === 0 ? 0.25 : 1,
            }}
            title={`Week of ${w.weekStart}: ${w.applied}`}
          />
          <span className="text-subtle text-[9px]">{w.weekStart.slice(5)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BreakdownTable({
  title,
  groups,
  note,
}: {
  title: string;
  groups: GroupStat[];
  note: string;
}) {
  if (groups.length === 0) return null;
  const tooFew = groups.every((g) => g.applied < 3);
  return (
    <section className={card} aria-label={title}>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="text-muted mb-3 text-xs">{note}</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-subtle font-mono text-[10px] tracking-wide uppercase">
            <th scope="col" className="pb-1.5 font-normal">
              Group
            </th>
            <th scope="col" className="pb-1.5 text-right font-normal">
              Applied
            </th>
            <th scope="col" className="pb-1.5 text-right font-normal">
              Heard back
            </th>
            <th scope="col" className="pb-1.5 text-right font-normal">
              Interview
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} className="border-border border-t">
              <th scope="row" className="py-1.5 font-normal">
                {g.label}
              </th>
              <td className="py-1.5 text-right tabular-nums">{g.applied}</td>
              <td className="py-1.5 text-right tabular-nums">{g.heardBack}</td>
              <td className="py-1.5 text-right tabular-nums">{g.interviewed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tooFew && (
        <p className="text-subtle mt-2 text-xs">
          Each group has only a few applications, so these counts cannot say which is better.
        </p>
      )}
    </section>
  );
}

function FindingCard({ f }: { f: Finding }) {
  return (
    <li className="border-border rounded-lg border p-4" data-testid={`finding-${f.id}`}>
      <h4 className="text-sm font-semibold">{f.title}</h4>
      <p className="text-muted mt-1 text-sm">{f.statement}</p>
      <details className="mt-2">
        <summary className="text-accent cursor-pointer text-xs">Why? The evidence</summary>
        <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-xs">
          {f.evidence.map((e) => (
            <li key={e} className="break-words">
              {e}
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-2 flex items-start gap-1.5 text-sm">
        <Lightbulb className="text-accent mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {f.suggestion}
          {f.href && (
            <>
              {" "}
              <Link href={f.href} prefetch={false} className="text-accent hover:underline">
                Open
              </Link>
            </>
          )}
        </span>
      </p>
    </li>
  );
}

/** "Why am I not getting interviews?" with its evidence, caveats and what it cannot know. */
export function InsightsPanel({
  insights,
  compact = false,
}: {
  insights: Insights;
  compact?: boolean;
}) {
  const findings = compact ? insights.findings.slice(0, 2) : insights.findings;
  return (
    <section aria-labelledby="why-heading" className={card} data-testid="insights">
      <h2 id="why-heading" className="text-sm font-semibold">
        Why am I not getting interviews?
      </h2>
      <p className="mt-2 text-base font-medium" data-testid="insights-headline">
        {insights.headline}
      </p>
      {insights.observations.length > 0 && (
        <ul className="text-muted mt-2 flex flex-col gap-1 text-sm">
          {insights.observations.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
      {findings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3" data-testid="findings">
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
        </ul>
      )}
      {compact && insights.findings.length > findings.length && (
        <p className="mt-3 text-xs">
          <Link href="/analytics" prefetch={false} className="text-accent hover:underline">
            See all {insights.findings.length} findings
          </Link>
        </p>
      )}
      {!compact && insights.caveats.length > 0 && (
        <ul
          className="text-subtle mt-4 flex list-disc flex-col gap-1 pl-5 text-xs"
          data-testid="caveats"
        >
          {insights.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  return (
    <div>
      {readiness.score === null ? (
        <p className="text-muted text-sm">
          Nothing to measure yet. Build your profile to see this.
        </p>
      ) : (
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums" data-testid="readiness-score">
            {readiness.score}
          </span>
          <span className="text-subtle"> / 100</span>
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2" data-testid="readiness-parts">
        {readiness.parts.map((p) => (
          <li key={p.id} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{p.label}</span>
              {p.value === null ? (
                <Badge variant="neutral">Not measured</Badge>
              ) : (
                <span className="tabular-nums">{p.value}</span>
              )}
            </div>
            <p className="text-muted mt-0.5">{p.evidence}</p>
          </li>
        ))}
      </ul>
      <p className="text-subtle mt-3 text-xs">
        How ready your own materials look. It says nothing about hiring odds.
      </p>
    </div>
  );
}
