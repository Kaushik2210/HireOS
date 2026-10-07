"use client";

import { Check, Copy, Download, FilePlus2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  approveVersionAction,
  deleteVersionAction,
  saveLetterVersionAction,
  saveResumeVersionAction,
} from "@/features/tailoring/actions";

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-danger text-xs">
      {message}
    </p>
  ) : null;
}

/** Saves the previewed resume as a new draft version. The server rebuilds it from stored data. */
export function SaveResumeButton({
  jobId,
  exclude,
  parentId,
  disabled,
}: {
  jobId: string;
  exclude: string[];
  parentId?: string | null;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            const result = await saveResumeVersionAction({ jobId, exclude, parentId });
            // A successful save redirects, so a result means something went wrong.
            if (!result.ok) setError(result.error);
          })
        }
      >
        <FilePlus2 /> {pending ? "Saving..." : "Save as new version"}
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

/** Edit-and-save for a cover letter. Wording the profile cannot support is flagged on save. */
export function LetterEditor({
  jobId,
  initialText,
  parentId,
}: {
  jobId: string;
  initialText: string;
  parentId?: string | null;
}) {
  const [text, setText] = useState(initialText);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveLetterVersionAction({ jobId, text, parentId });
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <label htmlFor="letter-text" className="text-sm font-medium">
        Your letter
      </label>
      <textarea
        id="letter-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        maxLength={20000}
        className="border-border-strong bg-background focus-visible:outline-accent w-full rounded-md border p-3 text-sm leading-relaxed"
      />
      <p className="text-subtle text-xs">
        Edit freely. Any skill or number that is not in your verified profile is flagged when you
        save, and a flagged version cannot be approved.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || text.trim().length === 0}>
          <FilePlus2 /> {pending ? "Saving..." : "Save as new version"}
        </Button>
        <ErrorLine message={error} />
      </div>
    </form>
  );
}

export function ApproveButton({ id, blocked }: { id: string; blocked: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        disabled={pending || blocked}
        onClick={() =>
          startTransition(async () => {
            const result = await approveVersionAction(id);
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
      >
        <Check /> {pending ? "Approving..." : "Approve this version"}
      </Button>
      {blocked && (
        <p className="text-muted text-xs">
          Approval is off because some lines could not be traced to your verified profile.
        </p>
      )}
      <ErrorLine message={error} />
    </div>
  );
}

export function DeleteVersionButton({ id, jobId }: { id: string; jobId: string }) {
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
            const result = await deleteVersionAction(id);
            if (result.ok) router.push(`/jobs/${jobId}`);
            else setError(result.error);
          })
        }
      >
        {pending ? "Deleting..." : "Confirm delete"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}

/** Copy and download are the only ways a document leaves the app: the user sends it themselves. */
export function ExportButtons({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setError(null);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setError("Could not copy. Select the text and copy it instead.");
          }
        }}
      >
        <Copy /> {copied ? "Copied" : "Copy text"}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        <Download /> Download .txt
      </Button>
      <ErrorLine message={error} />
    </div>
  );
}
