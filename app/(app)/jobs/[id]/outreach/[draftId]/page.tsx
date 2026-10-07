import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import type { OutreachDraft } from "@/db/outreach/store";
import { getProfileStore } from "@/db/profile";
import { DraftEditor } from "@/features/outreach/components/draft-editor";
import { Guardrail } from "@/features/outreach/components/guardrail";
import { VerificationNote } from "@/features/tailoring/components/panels";
import { requireUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import { OUTREACH_META } from "@/lib/outreach/types";
import { buildCandidate } from "@/services/matching/candidate";

export const metadata: Metadata = { title: "Outreach draft" };
export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string; draftId: string }>;
}) {
  const p = await params;
  const jobId = z.uuid().safeParse(p.id);
  const draftId = z.uuid().safeParse(p.draftId);
  if (!jobId.success || !draftId.success) notFound();
  const user = await requireUser();

  let job: Job | null = null;
  let draft: OutreachDraft | null = null;
  let currentHash: string | null = null;
  try {
    [job, draft, currentHash] = await Promise.all([
      getJobStore(user).then((s) => s.get(user.id, jobId.data)),
      getOutreachStore(user).then((s) => s.get(user.id, draftId.data)),
      getProfileStore(user).then(async (s) => buildCandidate(await s.getSnapshot(user.id)).hash),
    ]);
  } catch {
    return (
      <div className="mx-auto max-w-3xl" role="alert">
        <div className="border-danger/40 flex items-start gap-3 rounded-lg border p-5">
          <TriangleAlert className="text-danger mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p className="text-muted text-sm">
            Could not load this draft. Your data is safe. Reload to try again.
          </p>
        </div>
      </div>
    );
  }
  if (!job || !draft || draft.jobId !== job.id) notFound();

  const meta = OUTREACH_META[draft.type];
  const stale = currentHash !== null && currentHash !== draft.profileHash;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          href={`/jobs/${job.id}/outreach`}
          prefetch={false}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to outreach
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{meta.label}</h1>
          <Badge variant={draft.status === "draft" ? "neutral" : "success"}>{draft.status}</Badge>
          {draft.doc.edited && <Badge variant="warning">Edited by you</Badge>}
          {user.isDemo && <Badge variant="accent">Demo data</Badge>}
        </div>
        <p className="text-muted mt-1 text-sm break-words">
          For{" "}
          <Link href={`/jobs/${job.id}`} prefetch={false} className="hover:underline">
            {job.title} at {job.company_name}
          </Link>
          {draft.recipientName ? `, to ${draft.recipientName}` : ""}
          {draft.recipientTitle ? ` (${draft.recipientTitle})` : ""}. Written {fmt(draft.createdAt)}
          {draft.sentAt ? `. You recorded it as sent ${fmt(draft.sentAt)}` : ""}.
        </p>
        {stale && draft.status === "draft" && (
          <p
            role="note"
            className="border-warning/40 text-warning mt-3 max-w-prose rounded border p-3 text-xs"
          >
            Your profile has changed since this draft was written. Write a new draft to pick up the
            changes.
          </p>
        )}
      </div>

      <Guardrail />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Draft" className="border-border bg-surface rounded-lg border p-5">
          <DraftEditor
            key={`${draft.id}-${draft.updatedAt}`}
            id={draft.id}
            channel={draft.channel}
            status={draft.status}
            blocked={!draft.verification.ok}
            initialSubject={draft.subject}
            initialBody={draft.body}
          />
        </section>
        <aside className="flex flex-col gap-4" aria-label="Review">
          <VerificationNote verification={draft.verification} />
          <div className="border-border bg-surface rounded-lg border p-4 text-xs">
            <h3 className="mb-1 text-sm font-semibold">How to use it</h3>
            <p className="text-muted">
              {draft.channel === "linkedin"
                ? "Copy the note, then paste it into LinkedIn yourself when you choose to connect. HireOS never opens, scrapes or automates LinkedIn."
                : "Copy the subject and message into your own email and send it yourself."}{" "}
              After you send it, record that here so you can see what you have already sent.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
