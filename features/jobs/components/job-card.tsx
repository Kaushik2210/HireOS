import { Building2, MapPin } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatJobPay, formatPostedDate } from "@/features/jobs/format";
import { label } from "@/features/profile/format";
import { StrengthChip } from "@/features/matching/components/strength";
import type { Job } from "@/lib/jobs/schemas";
import type { MatchLabel } from "@/lib/matching/types";

const MAX_SKILLS = 6;

export function JobCard({
  job,
  match,
}: {
  job: Job;
  /** Present once the person has verified profile data to compare with. */
  match?: { strength: number; label: MatchLabel };
}) {
  const pay = formatJobPay(job);
  const posted = formatPostedDate(job.posted_at);
  const skills = job.required_skills.slice(0, MAX_SKILLS);
  const more = job.required_skills.length - skills.length;

  return (
    <li className="border-border bg-surface hover:bg-surface-hover rounded-lg border transition-colors">
      <Link
        href={`/jobs/${job.id}`}
        // A list can hold dozens of cards; prefetching each one floods the server.
        prefetch={false}
        className="flex flex-col gap-3 rounded-lg p-4 focus-visible:outline-offset-[-2px]"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold break-words">{job.title}</h3>
            <p className="text-muted mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                {job.company_name}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {job.location ?? "Location not stated"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {match && <StrengthChip strength={match.strength} label={match.label} />}
            {job.is_demo && <Badge variant="accent">Demo data</Badge>}
            {job.owner_user_id && <Badge variant="warning">Added by you</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {job.work_mode && <Badge>{label(job.work_mode)}</Badge>}
          {job.job_type && <Badge>{label(job.job_type)}</Badge>}
          {job.seniority && <Badge>{label(job.seniority)}</Badge>}
          {pay ? (
            <span className="text-foreground ml-1 text-xs">{pay}</span>
          ) : (
            <span className="text-subtle ml-1 text-xs">Pay not stated</span>
          )}
        </div>

        {skills.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Required skills">
            {skills.map((skill) => (
              <li
                key={skill}
                className="border-border-strong text-muted rounded border px-1.5 py-0.5 text-xs"
              >
                {skill}
              </li>
            ))}
            {more > 0 && <li className="text-subtle px-1 py-0.5 text-xs">+{more} more</li>}
          </ul>
        )}

        {posted && <p className="text-subtle text-xs">Posted {posted}</p>}
      </Link>
    </li>
  );
}
