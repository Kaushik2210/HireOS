"use client";

import { ExternalLink, MapPin, Pencil, Target, UserRound } from "lucide-react";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SingletonRecord } from "@/db/profile/store";
import { saveGoalsAction, saveProfileAction } from "@/features/profile/actions";
import { EntityDialog } from "@/features/profile/components/entity-dialog";
import { EntityForm, toFormValues } from "@/features/profile/components/entity-form";
import { GOALS_FORM, PROFILE_FORM } from "@/features/profile/config";
import { formatSalary, label } from "@/features/profile/format";

function EditDialog({
  title,
  config,
  record,
  action,
  trigger,
}: {
  title: string;
  config: typeof PROFILE_FORM;
  record: Record<string, unknown> | null;
  action: (values: unknown) => ReturnType<typeof saveProfileAction>;
  trigger: React.ReactNode;
}) {
  return (
    <EntityDialog title={title} trigger={trigger}>
      {(close) => (
        <EntityForm
          idPrefix={title.replace(/\s+/g, "-").toLowerCase()}
          fields={config.fields}
          schema={config.schema}
          values={toFormValues(config.fields, config.defaults, record ?? undefined)}
          submitLabel="Save"
          onSubmit={(values) => action(values)}
          onDone={close}
        />
      )}
    </EntityDialog>
  );
}

export function ProfileCard({ profile }: { profile: SingletonRecord<"profiles"> | null }) {
  if (!profile) {
    return (
      <section
        aria-labelledby="profile-heading"
        className="border-border bg-surface rounded-lg border p-5"
      >
        <h3 id="profile-heading" className="sr-only">
          Profile
        </h3>
        <EmptyState
          icon={UserRound}
          title="Create your profile"
          description="Start with your name and a short headline. Everything else builds on this."
          action={
            <EditDialog
              title="Create profile"
              config={PROFILE_FORM}
              record={null}
              action={saveProfileAction}
              trigger={<Button variant="primary">Create profile</Button>}
            />
          }
        />
      </section>
    );
  }

  const salary = formatSalary(
    profile.expected_salary_min,
    profile.expected_salary_max,
    profile.salary_currency,
    profile.salary_period,
  );
  const links = [
    { href: profile.linkedin_url, label: "LinkedIn" },
    { href: profile.github_url, label: "GitHub" },
    { href: profile.website_url, label: "Website" },
  ].filter((l): l is { href: string; label: string } => Boolean(l.href));

  return (
    <section
      id="profile"
      aria-labelledby="profile-heading"
      className="border-border bg-surface scroll-mt-20 rounded-lg border p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="profile-heading" className="text-lg font-semibold tracking-tight">
            {profile.full_name}
          </h3>
          {profile.headline && <p className="text-muted mt-0.5 text-sm">{profile.headline}</p>}
          <div className="text-subtle mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {profile.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {profile.location}
              </span>
            )}
            {profile.experience_level && <span>{label(profile.experience_level)}</span>}
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent inline-flex items-center gap-1 hover:underline"
              >
                {l.label}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
        <EditDialog
          title="Edit profile"
          config={PROFILE_FORM}
          record={profile as unknown as Record<string, unknown>}
          action={saveProfileAction}
          trigger={
            <Button variant="secondary" size="sm">
              <Pencil /> Edit
            </Button>
          }
        />
      </div>

      {profile.summary && (
        <p className="text-muted mt-4 text-sm leading-relaxed">{profile.summary}</p>
      )}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Preference term="Work mode" values={profile.work_modes.map(label)} />
        <Preference term="Job types" values={profile.job_types.map(label)} />
        <Preference term="Preferred locations" values={profile.preferred_locations} />
        <div>
          <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">
            Salary expectation
          </dt>
          <dd className="mt-1">{salary || <span className="text-subtle">Not set</span>}</dd>
        </div>
      </dl>
    </section>
  );
}

function Preference({ term, values }: { term: string; values: string[] }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[10px] tracking-wide uppercase">{term}</dt>
      <dd className="mt-1 flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((v) => <Badge key={v}>{v}</Badge>)
        ) : (
          <span className="text-subtle text-sm">Not set</span>
        )}
      </dd>
    </div>
  );
}

export function GoalsCard({ goals }: { goals: SingletonRecord<"career_goals"> | null }) {
  const editButton = (text: string, primary = false) => (
    <Button variant={primary ? "primary" : "secondary"} size="sm">
      <Target /> {text}
    </Button>
  );

  return (
    <section
      id="goals"
      aria-labelledby="goals-heading"
      className="border-border bg-surface scroll-mt-20 rounded-lg border p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 id="goals-heading" className="text-sm font-semibold">
            Career goal
          </h3>
          <p className="text-muted mt-1 text-sm">
            What you are aiming for. Autopilot and gap analysis use this.
          </p>
        </div>
        {goals && (
          <EditDialog
            title="Edit career goal"
            config={GOALS_FORM}
            record={goals as unknown as Record<string, unknown>}
            action={saveGoalsAction}
            trigger={editButton("Edit")}
          />
        )}
      </div>

      {goals ? (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {goals.target_roles.map((r) => (
              <Badge key={r} variant="accent">
                {r}
              </Badge>
            ))}
          </div>
          <p className="text-subtle text-xs">
            {[
              goals.target_level ? label(goals.target_level) : "",
              goals.timeline_months ? `within ${goals.timeline_months} months` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {goals.statement && <p className="text-muted">{goals.statement}</p>}
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title="No career goal set"
          description="Name the role you want and when. It focuses job matching and gap analysis."
          action={
            <EditDialog
              title="Set career goal"
              config={GOALS_FORM}
              record={null}
              action={saveGoalsAction}
              trigger={editButton("Set goal", true)}
            />
          }
        />
      )}
    </section>
  );
}
