import { Briefcase } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { StrengthChip } from "@/features/matching/components/strength";
import { normalizeKey } from "@/lib/skills/catalog";
import type { Candidate } from "@/services/matching/candidate";
import type { RankedJob } from "@/services/matching/rank";

/** The best few matches, each with how many required skills are covered and which are not. */
export function TopOpportunities({
  ranked,
  candidate,
  pending,
}: {
  ranked: RankedJob[];
  candidate: Candidate | null;
  pending: number;
}) {
  if (!candidate?.hasVerifiedData) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Nothing to rank yet"
        description={
          pending > 0
            ? "Review your imported profile items. Only confirmed items are used for matching."
            : "Add your skills, projects and experience to see your strongest matches."
        }
        action={
          <Button asChild variant="secondary" size="sm">
            <Link prefetch={false} href="/profile">
              {pending > 0 ? "Review profile" : "Build your profile"}
            </Link>
          </Button>
        }
      />
    );
  }
  if (ranked.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="No jobs to rank"
        description="Add a job you found, or show the sample jobs again."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link prefetch={false} href="/jobs">
              Go to jobs
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <ol className="divide-border divide-y" data-testid="top-opportunities">
        {ranked.slice(0, 3).map(({ job, match }) => {
          const missing = job.required_skills.filter((s) => !candidate.skills.has(normalizeKey(s)));
          const have = job.required_skills.length - missing.length;
          return (
            <li key={job.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/jobs/${job.id}`}
                  prefetch={false}
                  className="min-w-0 text-sm font-medium hover:underline"
                >
                  <span className="break-words">{job.title}</span>
                  <span className="text-muted block text-xs font-normal">{job.company_name}</span>
                </Link>
                <StrengthChip strength={match.strength} label={match.label} />
              </div>
              {job.required_skills.length > 0 && (
                <p className="text-muted mt-1.5 text-xs">
                  Skill match: {have} of {job.required_skills.length} required.
                  {missing.length > 0 &&
                    ` Missing: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", and more" : ""}.`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Link
        prefetch={false}
        href="/matches"
        className="text-accent mt-3 inline-block text-xs hover:underline"
      >
        See all matches
      </Link>
    </div>
  );
}
