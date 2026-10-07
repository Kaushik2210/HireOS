"use client";

import { ListPlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-field";
import {
  addEventAction,
  deleteApplicationAction,
  moveApplicationAction,
  trackJobAction,
  updateDetailsAction,
  wipeDemoApplicationsAction,
} from "@/features/applications/actions";
import {
  INITIAL_STATUSES,
  STATUS_LABELS,
  TRANSITIONS,
  type InitialStatus,
  type Status,
} from "@/lib/applications/types";

type Result = { ok: boolean; error?: string; message?: string };

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage(result.message ? { text: result.message, error: false } : null);
        after?.();
        router.refresh();
      } else {
        setMessage({ text: result.error ?? "Something went wrong.", error: true });
      }
    });
  return { pending, message, run, router };
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p
      role={message.error ? "alert" : "status"}
      className={`text-xs ${message.error ? "text-danger" : "text-muted"}`}
    >
      {message.text}
    </p>
  );
}

const caption = "text-subtle font-mono text-[10px] tracking-wide uppercase";

/** Adds the job to the pipeline. "Applied" is the person saying they applied on the employer's page. */
export function TrackJobForm({ jobId }: { jobId: string }) {
  const { pending, message, run } = useAction();
  const [status, setStatus] = useState<InitialStatus>("shortlisted");
  const [appliedOn, setAppliedOn] = useState("");
  return (
    <form
      aria-label="Add to your pipeline"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          trackJobAction({
            jobId,
            status,
            applied_on: status === "applied" && appliedOn ? appliedOn : null,
          }),
        );
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Track as</span>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as InitialStatus)}
          className="w-44"
        >
          {INITIAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </label>
      {status === "applied" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className={caption}>Applied on (optional)</span>
          <Input
            type="date"
            value={appliedOn}
            onChange={(e) => setAppliedOn(e.target.value)}
            className="w-44"
          />
        </label>
      )}
      <Button type="submit" variant="secondary" disabled={pending}>
        <ListPlus /> {pending ? "Adding..." : "Add to pipeline"}
      </Button>
      <Message message={message} />
    </form>
  );
}

/** A quick move from the board. Only moves the pipeline allows are offered. */
export function QuickMove({ id, status, title }: { id: string; status: Status; title: string }) {
  const { pending, message, run } = useAction();
  const next = TRANSITIONS[status];
  if (next.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <label className="sr-only" htmlFor={`move-${id}`}>
        Move {title} to
      </label>
      <Select
        id={`move-${id}`}
        value=""
        disabled={pending}
        className="h-8 text-xs"
        onChange={(e) => {
          const to = e.target.value as Status;
          if (to) run(() => moveApplicationAction({ id, status: to }));
        }}
      >
        <option value="">Move to...</option>
        {next.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Message message={message} />
    </div>
  );
}

/** The full status change, with a note and, for "applied", the date. */
export function StatusPanel({ id, status }: { id: string; status: Status }) {
  const { pending, message, run } = useAction();
  const [to, setTo] = useState<Status | "">("");
  const [note, setNote] = useState("");
  const [on, setOn] = useState("");
  const next = TRANSITIONS[status];

  if (next.length === 0) {
    return (
      <p className="text-muted text-sm">
        {STATUS_LABELS[status]} is final. Nothing further can be recorded for this application.
      </p>
    );
  }
  return (
    <form
      aria-label="Change status"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to) return;
        run(
          () =>
            moveApplicationAction({ id, status: to, note, on: to === "applied" && on ? on : null }),
          () => {
            setTo("");
            setNote("");
            setOn("");
          },
        );
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Move to</span>
        <Select value={to} onChange={(e) => setTo(e.target.value as Status | "")}>
          <option value="">Choose a status</option>
          {next.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </label>
      {to === "applied" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className={caption}>Applied on (optional)</span>
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          <span className="text-muted text-xs">
            Only say this once you have applied on the employer&apos;s own page. HireOS never
            applies for you.
          </span>
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Note (optional)</span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !to}>
          {pending ? "Saving..." : "Move"}
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

export interface DocOption {
  id: string;
  label: string;
}

/** Notes, the follow-up date and which saved documents were used. */
export function DetailsForm({
  id,
  notes,
  followUpOn,
  resumeId,
  letterId,
  resumes,
  letters,
}: {
  id: string;
  notes: string | null;
  followUpOn: string | null;
  resumeId: string | null;
  letterId: string | null;
  resumes: DocOption[];
  letters: DocOption[];
}) {
  const { pending, message, run } = useAction();
  const [n, setN] = useState(notes ?? "");
  const [f, setF] = useState(followUpOn ?? "");
  const [r, setR] = useState(resumeId ?? "");
  const [l, setL] = useState(letterId ?? "");
  return (
    <form
      aria-label="Application details"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateDetailsAction({
            id,
            notes: n,
            follow_up_on: f || null,
            resume_version_id: r || null,
            cover_letter_version_id: l || null,
          }),
        );
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Notes</span>
        <Textarea value={n} onChange={(e) => setN(e.target.value)} rows={4} maxLength={2000} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Follow up on</span>
        <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="w-48" />
        <span className="text-muted text-xs">
          Optional. Without a date, HireOS flags it after a quiet week.
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className={caption}>Resume used</span>
          <Select value={r} onChange={(e) => setR(e.target.value)}>
            <option value="">None linked</option>
            {resumes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className={caption}>Cover letter used</span>
          <Select value={l} onChange={(e) => setL(e.target.value)}>
            <option value="">None linked</option>
            {letters.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving..." : "Save details"}
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const { pending, message, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <form
      aria-label="Add a note"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => addEventAction({ id, kind: "note", note }),
          () => setNote(""),
        );
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={caption}>Add to the timeline</span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending || note.trim().length === 0}
        >
          Add note
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

/** Records the person's own follow-up. HireOS sends nothing. */
export function FollowedUpButton({ id }: { id: string }) {
  const { pending, message, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => run(() => addEventAction({ id, kind: "followed_up" }))}
      >
        I followed up
      </Button>
      <Message message={message} />
    </div>
  );
}

export function DeleteApplicationButton({ id }: { id: string }) {
  const { pending, message, run, router } = useAction();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 /> Delete
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () => deleteApplicationAction(id),
            () => router.push("/applications"),
          )
        }
      >
        Confirm delete
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <Message message={message} />
    </div>
  );
}

export function WipeSamplesButton() {
  const { pending, message, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => run(() => wipeDemoApplicationsAction())}
      >
        {pending ? "Clearing..." : "Clear sample applications"}
      </Button>
      <Message message={message} />
    </div>
  );
}
