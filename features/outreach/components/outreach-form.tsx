"use client";

import { PenLine } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form-field";
import { createDraftAction } from "@/features/outreach/actions";
import {
  CONFIRM_TEXT,
  OUTREACH_META,
  OUTREACH_TYPES,
  type OutreachType,
} from "@/lib/outreach/types";

const caption = "text-subtle font-mono text-[10px] tracking-wide uppercase";
const field = "flex flex-col gap-1.5 text-sm";

/**
 * Who the message is for, plus the few facts only the person knows. Typed values go to the
 * server in the request body, never into the page address.
 */
export function OutreachForm({
  jobId,
  initialType = "recruiter",
}: {
  jobId: string;
  initialType?: OutreachType;
}) {
  const [type, setType] = useState<OutreachType>(initialType);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const meta = OUTREACH_META[type];
  const showContext = Boolean(meta.needsContext) || type === "referral";
  const confirmText = meta.confirm ? CONFIRM_TEXT[meta.confirm] : null;
  const ready = (!meta.needsContext || context.trim().length > 0) && (!meta.confirm || confirmed);

  return (
    <form
      aria-label="Write an outreach draft"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createDraftAction({
            jobId,
            type,
            recipient_name: name,
            recipient_title: title,
            shared_context: showContext ? context : "",
            confirm_applied: meta.confirm === "applied" && confirmed,
            confirm_spoken: meta.confirm === "spoken" && confirmed,
          });
          // A successful save redirects, so a result means something went wrong.
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <label className={field}>
        <span className={caption}>Kind of message</span>
        <Select
          name="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as OutreachType);
            setConfirmed(false);
          }}
        >
          {OUTREACH_TYPES.map((t) => (
            <option key={t} value={t}>
              {OUTREACH_META[t].label}
            </option>
          ))}
        </Select>
        <span className="text-muted text-xs">{meta.description}</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          <span className={caption}>Their name (optional)</span>
          <Input
            name="recipient_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <label className={field}>
          <span className={caption}>Their role (optional)</span>
          <Input
            name="recipient_title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            autoComplete="off"
          />
        </label>
      </div>

      {showContext && (
        <label className={field}>
          <span className={caption}>
            How you know them {meta.needsContext ? "(required)" : "(optional)"}
          </span>
          <Textarea
            name="shared_context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="In your own words, for example: We both studied at Riverside Institute."
          />
          <span className="text-muted text-xs">
            Included as you write it. HireOS cannot check how you know someone.
          </span>
        </label>
      )}

      {confirmText && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span>
            {confirmText}
            <span className="text-muted block text-xs">
              The draft only says this once you confirm it is true.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          <PenLine /> {pending ? "Writing..." : "Write draft"}
        </Button>
        {error && (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
