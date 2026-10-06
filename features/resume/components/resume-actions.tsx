"use client";

import { Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteResumeAction, importResumeAction } from "@/features/resume/actions";

export function ImportPanel({ resumeId, itemCount }: { resumeId: string; itemCount: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-sm">
        {itemCount > 0
          ? `${itemCount} new ${itemCount === 1 ? "item" : "items"} can be added to your profile. They arrive unconfirmed: nothing counts as verified, and nothing is used in a resume or message, until you review it.`
          : "Everything found here is already in your profile, or nothing could be read reliably."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={pending || itemCount === 0}
          onClick={() =>
            startTransition(async () => {
              const r = await importResumeAction(resumeId);
              setResult({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : r.error });
            })
          }
        >
          {pending ? "Adding…" : "Add to profile for review"}
        </Button>
        {result?.ok && (
          <Link href="/profile#review" className="text-accent text-sm hover:underline">
            Review on your profile
          </Link>
        )}
      </div>
      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-success text-sm" : "text-danger text-sm"}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}

export function ResumeToolbar({
  resumeId,
  canDownload,
}: {
  resumeId: string;
  canDownload: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDownload && (
        <Button asChild variant="secondary" size="sm">
          <a href={`/api/resumes/${resumeId}/file`}>
            <Download /> Download original
          </a>
        </Button>
      )}
      {confirming ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteResumeAction(resumeId);
                if (r.ok) router.push("/resume");
                else setError(r.error);
              })
            }
          >
            {pending ? "Deleting…" : "Confirm delete"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 /> Delete
        </Button>
      )}
      {error && (
        <p role="alert" className="text-danger w-full text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
