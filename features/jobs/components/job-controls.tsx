"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EntityDialog } from "@/components/forms/entity-dialog";
import { EntityForm } from "@/components/forms/entity-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addJobAction, deleteJobAction, setDemoHiddenAction } from "@/features/jobs/actions";
import { MANUAL_JOB_DEFAULTS, MANUAL_JOB_FIELDS, manualJobFormSchema } from "@/features/jobs/form";

export function AddJobDialog({ trigger }: { trigger?: React.ReactNode }) {
  return (
    <EntityDialog
      title="Add a job"
      description="Paste a posting you found. It stays private to you, and nothing is fetched from any website."
      trigger={
        trigger ?? (
          <Button variant="secondary" size="sm">
            <Plus /> Add a job
          </Button>
        )
      }
    >
      {(close) => (
        <EntityForm
          idPrefix="add-job"
          fields={MANUAL_JOB_FIELDS}
          schema={manualJobFormSchema}
          values={MANUAL_JOB_DEFAULTS}
          submitLabel="Add job"
          onSubmit={(values) => addJobAction(values)}
          onDone={close}
        />
      )}
    </EntityDialog>
  );
}

interface DemoBannerProps {
  hidden: boolean;
  /** True when there is no account at all, so hiding means wiping the visitor's sandbox. */
  sandbox: boolean;
}

export function DemoBanner({ hidden, sandbox }: DemoBannerProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () =>
    startTransition(async () => {
      const result = await setDemoHiddenAction(!hidden);
      setError(result.ok ? null : result.error);
    });

  return (
    <section
      aria-labelledby="demo-jobs-heading"
      className="border-accent/30 bg-accent-soft rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="accent">Demo data</Badge>
        <h2 id="demo-jobs-heading" className="text-sm font-medium">
          {hidden ? "Sample jobs are hidden" : "These jobs are fictional samples"}
        </h2>
      </div>
      <p className="text-muted mt-1 text-sm">
        {hidden
          ? "Only jobs you add yourself are shown."
          : "Companies, roles and application links are invented, so you can explore without real data."}{" "}
        {sandbox
          ? "Changes are private to your browser session."
          : "This only affects what you see."}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={toggle}>
          {hidden ? "Show demo jobs" : sandbox ? "Wipe demo jobs" : "Hide demo jobs"}
        </Button>
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export function DeleteJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 /> Delete
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteJobAction(jobId);
            if (result.ok) router.push("/jobs");
            else setError(result.error);
          })
        }
      >
        {pending ? "Deleting…" : "Confirm delete"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      {error && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
