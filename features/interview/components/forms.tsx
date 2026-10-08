"use client";

import { CalendarPlus, ListPlus, Play, RefreshCw, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-field";
import {
  addChecklistItemAction,
  addInterviewAction,
  deleteInterviewAction,
  deletePracticeAction,
  refreshChecklistAction,
  removeChecklistItemAction,
  startPracticeAction,
  submitAnswerAction,
  toggleChecklistAction,
  updateInterviewAction,
} from "@/features/interview/actions";
import {
  FORMATS,
  FORMAT_LABELS,
  INTERVIEW_KINDS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_STATUSES,
  MAX_ANSWER,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  MOCK_FOCUS,
  MOCK_FOCUS_LABELS,
  type ChecklistItem,
  type InterviewFormat,
  type InterviewKind,
  type InterviewStatus,
  type MockFocus,
} from "@/lib/interview/types";

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
const field = "flex flex-col gap-1.5 text-sm";

interface RoundValues {
  round_label: string;
  kind: InterviewKind;
  format: InterviewFormat | "";
  scheduled_on: string;
  scheduled_time: string;
  interviewer: string;
  notes: string;
}

const EMPTY: RoundValues = {
  round_label: "",
  kind: "phone_screen",
  format: "",
  scheduled_on: "",
  scheduled_time: "",
  interviewer: "",
  notes: "",
};

/** The fields shared by adding and editing a round. */
function RoundFields({
  values,
  onChange,
}: {
  values: RoundValues;
  onChange: (next: RoundValues) => void;
}) {
  const set = <K extends keyof RoundValues>(key: K, value: RoundValues[K]) =>
    onChange({ ...values, [key]: value });
  return (
    <>
      <label className={field}>
        <span className={caption}>Round name</span>
        <Input
          value={values.round_label}
          onChange={(e) => set("round_label", e.target.value)}
          maxLength={100}
          placeholder="For example: Phone screen"
          required
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          <span className={caption}>Kind</span>
          <Select
            value={values.kind}
            onChange={(e) => set("kind", e.target.value as InterviewKind)}
          >
            {INTERVIEW_KINDS.map((k) => (
              <option key={k} value={k}>
                {INTERVIEW_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className={field}>
          <span className={caption}>Format</span>
          <Select
            value={values.format}
            onChange={(e) => set("format", e.target.value as InterviewFormat | "")}
          >
            <option value="">Not sure yet</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </label>
        <label className={field}>
          <span className={caption}>Date (optional)</span>
          <Input
            type="date"
            value={values.scheduled_on}
            onChange={(e) => set("scheduled_on", e.target.value)}
          />
        </label>
        <label className={field}>
          <span className={caption}>Time (optional)</span>
          <Input
            type="time"
            value={values.scheduled_time}
            onChange={(e) => set("scheduled_time", e.target.value)}
          />
        </label>
      </div>
      <label className={field}>
        <span className={caption}>Interviewer (optional)</span>
        <Input
          value={values.interviewer}
          onChange={(e) => set("interviewer", e.target.value)}
          maxLength={150}
        />
      </label>
      <label className={field}>
        <span className={caption}>Notes (optional)</span>
        <Textarea
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </label>
    </>
  );
}

const toPayload = (v: RoundValues) => ({
  round_label: v.round_label,
  kind: v.kind,
  format: v.format || null,
  scheduled_on: v.scheduled_on || null,
  scheduled_time: v.scheduled_time || null,
  interviewer: v.interviewer,
  notes: v.notes,
});

/** Records a round for an application. A prep checklist is written for it automatically. */
export function AddInterviewForm({ applicationId }: { applicationId: string }) {
  const { pending, message, run } = useAction();
  const [values, setValues] = useState<RoundValues>(EMPTY);
  return (
    <form
      aria-label="Add an interview"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        // A successful save redirects to the new round, so a result means something went wrong.
        run(() => addInterviewAction({ application_id: applicationId, ...toPayload(values) }));
      }}
    >
      <RoundFields values={values} onChange={setValues} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || values.round_label.trim().length === 0}
        >
          <CalendarPlus /> {pending ? "Saving..." : "Add interview"}
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

export function EditInterviewForm({
  id,
  initial,
  status,
}: {
  id: string;
  initial: Omit<RoundValues, "format"> & { format: InterviewFormat | null };
  status: InterviewStatus;
}) {
  const { pending, message, run } = useAction();
  const [values, setValues] = useState<RoundValues>({ ...initial, format: initial.format ?? "" });
  const [state, setState] = useState<InterviewStatus>(status);
  return (
    <form
      aria-label="Interview details"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateInterviewAction({ id, ...toPayload(values), status: state }));
      }}
    >
      <RoundFields values={values} onChange={setValues} />
      <label className={field}>
        <span className={caption}>Status</span>
        <Select
          value={state}
          onChange={(e) => setState(e.target.value as InterviewStatus)}
          className="w-48"
        >
          {INTERVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "scheduled" ? "Scheduled" : s === "completed" ? "Completed" : "Cancelled"}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || values.round_label.trim().length === 0}
        >
          {pending ? "Saving..." : "Save details"}
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

export function ChecklistPanel({ id, items }: { id: string; items: ChecklistItem[] }) {
  const { pending, message, run } = useAction();
  const [text, setText] = useState("");
  // Ticks show at once; the server's list replaces this whenever it changes.
  const [local, setLocal] = useState(items);
  const [seen, setSeen] = useState(items);
  if (seen !== items) {
    setSeen(items);
    setLocal(items);
  }
  const done = local.filter((i) => i.done).length;

  const toggle = (item: ChecklistItem, checked: boolean) => {
    setLocal((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: checked } : i)));
    run(async () => {
      const result = await toggleChecklistAction({ id, item_id: item.id, done: checked });
      if (!result.ok) setLocal(items);
      return result;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-xs" aria-live="polite" data-testid="checklist-progress">
        {done} of {local.length} done
      </p>
      <ul className="flex flex-col gap-2" data-testid="checklist">
        {local.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <input
              id={`item-${item.id}`}
              type="checkbox"
              checked={item.done}
              className="mt-1"
              onChange={(e) => toggle(item, e.target.checked)}
            />
            <label
              htmlFor={`item-${item.id}`}
              className={item.done ? "text-muted line-through" : ""}
            >
              <span className="break-words">{item.text}</span>
            </label>
            {item.source === "custom" && (
              <button
                type="button"
                className="text-muted hover:text-danger ml-auto shrink-0 p-1"
                aria-label={`Remove: ${item.text}`}
                disabled={pending}
                onClick={() => run(() => removeChecklistItemAction({ id, item_id: item.id }))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        aria-label="Add a checklist item"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addChecklistItemAction({ id, text }),
            () => setText(""),
          );
        }}
      >
        <label className="sr-only" htmlFor={`new-item-${id}`}>
          New checklist item
        </label>
        <Input
          id={`new-item-${id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Add your own item"
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending || text.trim().length === 0}
        >
          <ListPlus /> Add
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => refreshChecklistAction(id))}
        >
          <RefreshCw /> Refresh suggestions
        </Button>
        <Message message={message} />
      </div>
    </div>
  );
}

export function DeleteInterviewButton({ id }: { id: string }) {
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
            () => deleteInterviewAction(id),
            () => router.push("/interviews"),
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

/* ---------- practice ---------- */

export function StartPracticeForm({ jobId }: { jobId: string }) {
  const { pending, message, run } = useAction();
  const [focus, setFocus] = useState<MockFocus>("technical");
  const [count, setCount] = useState(5);
  return (
    <form
      aria-label="Start a practice session"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => startPracticeAction({ jobId, focus, count }));
      }}
    >
      <label className={field}>
        <span className={caption}>Practise</span>
        <Select
          value={focus}
          onChange={(e) => setFocus(e.target.value as MockFocus)}
          className="w-52"
        >
          {MOCK_FOCUS.map((f) => (
            <option key={f} value={f}>
              {MOCK_FOCUS_LABELS[f]}
            </option>
          ))}
        </Select>
      </label>
      <label className={field}>
        <span className={caption}>Questions</span>
        <Select value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24">
          {Array.from(
            { length: MAX_QUESTIONS - MIN_QUESTIONS + 1 },
            (_, i) => MIN_QUESTIONS + i,
          ).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        <Play /> {pending ? "Starting..." : "Start practice"}
      </Button>
      <Message message={message} />
    </form>
  );
}

export function AnswerForm({
  sessionId,
  position,
  last,
}: {
  sessionId: string;
  position: number;
  last: boolean;
}) {
  const { pending, message, run } = useAction();
  const [answer, setAnswer] = useState("");
  return (
    <form
      aria-label="Answer this question"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => submitAnswerAction({ sessionId, position, answer }),
          () => setAnswer(""),
        );
      }}
    >
      <label htmlFor={`answer-${position}`} className="text-sm font-medium">
        Your answer
      </label>
      <Textarea
        id={`answer-${position}`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={9}
        maxLength={MAX_ANSWER}
        placeholder="Write the answer as you would say it out loud."
        className="leading-relaxed"
      />
      <p className="text-subtle text-xs" aria-live="polite">
        {answer.length} of {MAX_ANSWER} characters. Aim for roughly one to two minutes spoken, about
        100 to 200 words.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || answer.trim().length === 0}>
          <Send /> {pending ? "Scoring..." : last ? "Submit and finish" : "Submit answer"}
        </Button>
        <Message message={message} />
      </div>
    </form>
  );
}

export function DeletePracticeButton({ id, redirectTo }: { id: string; redirectTo?: string }) {
  const { pending, message, run, router } = useAction();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 /> Delete session
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
            () => deletePracticeAction(id),
            () => redirectTo && router.push(redirectTo),
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
