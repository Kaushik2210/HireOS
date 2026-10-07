"use client";

import { Check, Copy, Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-field";
import {
  approveDraftAction,
  deleteDraftAction,
  markSentAction,
  saveDraftEditAction,
} from "@/features/outreach/actions";
import { LINKEDIN_NOTE_LIMIT, type Channel, type DraftStatus } from "@/lib/outreach/types";

function Note({ message, tone }: { message: string | null; tone: "error" | "info" }) {
  if (!message) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`text-xs ${tone === "error" ? "text-danger" : "text-muted"}`}
    >
      {message}
    </p>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setFailed(false);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setFailed(true);
          }
        }}
      >
        <Copy /> {copied ? "Copied" : label}
      </Button>
      {failed && (
        <span className="text-danger text-xs">Could not copy. Select the text instead.</span>
      )}
    </span>
  );
}

/**
 * Edit, review and record one draft. Copying is the only way the words leave HireOS: the
 * person pastes them into their own email or LinkedIn and sends them there.
 */
export function DraftEditor({
  id,
  channel,
  status,
  blocked,
  initialSubject,
  initialBody,
}: {
  id: string;
  channel: Channel;
  status: DraftStatus;
  blocked: boolean;
  initialSubject: string | null;
  initialBody: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const editable = status === "draft";
  const dirty = subject !== (initialSubject ?? "") || body !== initialBody;
  const isNote = channel === "linkedin";

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; message?: string }>,
    after?: () => void,
  ) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage(result.message ? { text: result.message, tone: "info" } : null);
        after?.();
        router.refresh();
      } else {
        setMessage({ text: result.error ?? "Something went wrong.", tone: "error" });
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {channel === "email" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-subtle font-mono text-[10px] tracking-wide uppercase">Subject</span>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            readOnly={!editable}
            aria-readonly={!editable}
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-subtle font-mono text-[10px] tracking-wide uppercase">
          {isNote ? "Note" : "Message"}
        </span>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={isNote ? 5 : 14}
          maxLength={5000}
          readOnly={!editable}
          aria-readonly={!editable}
          className="leading-relaxed"
        />
        {isNote && (
          <span
            className={`text-xs ${body.length > LINKEDIN_NOTE_LIMIT ? "text-danger" : "text-muted"}`}
            aria-live="polite"
          >
            {body.length} of {LINKEDIN_NOTE_LIMIT} characters
          </span>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <Button
            type="button"
            variant="primary"
            disabled={pending || !dirty || body.trim().length === 0}
            onClick={() =>
              run(() =>
                saveDraftEditAction({
                  id,
                  text: body,
                  subject: channel === "email" ? subject : undefined,
                }),
              )
            }
          >
            <Save /> {pending ? "Saving..." : "Save changes"}
          </Button>
        )}
        {status === "draft" && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending || blocked || dirty}
            onClick={() => run(() => approveDraftAction(id))}
          >
            <Check /> Approve draft
          </Button>
        )}
        {status === "approved" && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => markSentAction(id))}
          >
            <Send /> I sent this myself
          </Button>
        )}
        {channel === "email" && <CopyButton text={subject} label="Copy subject" />}
        <CopyButton text={body} label={isNote ? "Copy note" : "Copy message"} />
      </div>
      {status === "draft" && dirty && (
        <p className="text-muted text-xs">Save your changes to re-check them before approving.</p>
      )}
      {status === "draft" && blocked && !dirty && (
        <p className="text-muted text-xs">
          Approval is off because some lines could not be traced to your verified profile.
        </p>
      )}
      <Note message={message?.text ?? null} tone={message?.tone ?? "info"} />

      <div className="border-border border-t pt-3">
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => deleteDraftAction(id),
                  () => router.push("/outreach"),
                )
              }
            >
              Confirm delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
