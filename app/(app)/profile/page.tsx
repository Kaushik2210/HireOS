import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { getProfileStore } from "@/db/profile";
import { EMPTY_SNAPSHOT, type ProfileSnapshot } from "@/db/profile/store";
import { DEMO_PERSONAS } from "@/db/seed/demo-personas";
import { CollectionSection } from "@/features/profile/components/collection-section";
import { CompletenessCard } from "@/features/profile/components/completeness-card";
import { DemoControls } from "@/features/profile/components/demo-controls";
import { GoalsCard, ProfileCard } from "@/features/profile/components/singleton-cards";
import { SECTION_ORDER } from "@/features/profile/config";
import { requireUser } from "@/lib/auth/session";
import type { CollectionEntity, CollectionItem } from "@/lib/profile/schemas";
import { computeCompleteness } from "@/services/profile/completeness";

export const metadata: Metadata = { title: "Career profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();

  let snapshot: ProfileSnapshot = EMPTY_SNAPSHOT;
  let loadFailed = false;
  try {
    snapshot = await (await getProfileStore(user)).getSnapshot(user.id);
  } catch {
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold">Could not load your profile</h1>
            <p className="text-muted mt-1 text-sm">
              Your data is safe. Reload the page, and if this keeps happening, try again in a few
              minutes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const completeness = computeCompleteness(snapshot);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Career profile</h1>
        <p className="text-muted mt-1 text-sm">
          The facts everything else is built from. Resumes, cover letters and outreach only ever use
          what is recorded here.
        </p>
      </div>

      {user.isDemo && (
        <DemoControls personas={DEMO_PERSONAS.map((p) => ({ id: p.id, label: p.label }))} />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ProfileCard profile={snapshot.profile} />
          <GoalsCard goals={snapshot.goals} />
          {SECTION_ORDER.map((entity) => (
            <CollectionSection
              key={entity}
              entity={entity}
              items={snapshot[entity as CollectionEntity] as CollectionItem<CollectionEntity>[]}
            />
          ))}
        </div>

        <aside
          aria-labelledby="completeness-heading"
          className="border-border bg-surface rounded-lg border p-5 lg:sticky lg:top-20"
        >
          <h2 id="completeness-heading" className="mb-4 text-sm font-semibold">
            Profile completeness
          </h2>
          <CompletenessCard completeness={completeness} showAll />
        </aside>
      </div>
    </div>
  );
}
