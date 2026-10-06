"use client";

import { Check, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmAllAction, confirmItemAction } from "@/features/profile/actions";
import { ItemDialog } from "@/features/profile/components/collection-section";
import { SECTIONS, type ItemSummary } from "@/features/profile/config";
import type { CollectionEntity, CollectionItem } from "@/lib/profile/schemas";

type AnyItem = CollectionItem<CollectionEntity>;
export interface PendingItem {
  entity: CollectionEntity;
  item: AnyItem;
}

function Row({ entity, item }: PendingItem) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const summary: ItemSummary = (SECTIONS[entity].summarize as (i: AnyItem) => ItemSummary)(item);

  return (
    <li className="border-border bg-surface-raised flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <Badge className="mr-2 align-middle">{SECTIONS[entity].title}</Badge>
          <span className="font-medium break-words">{summary.title}</span>
        </p>
        {(summary.subtitle || summary.meta) && (
          <p className="text-subtle mt-0.5 text-xs break-words">
            {[summary.subtitle, summary.meta].filter(Boolean).join(" · ")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger mt-1 text-xs">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ItemDialog
          entity={entity}
          item={item}
          trigger={
            <Button variant="ghost" size="sm" aria-label={`Edit ${summary.title}`}>
              <Pencil /> Edit
            </Button>
          }
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-label={`Confirm ${summary.title}`}
          onClick={() =>
            startTransition(async () => {
              const r = await confirmItemAction(entity, item.id);
              if (!r.ok) setError(r.error);
            })
          }
        >
          <Check /> Confirm
        </Button>
      </div>
    </li>
  );
}

export function ReviewPanel({ items }: { items: PendingItem[] }) {
  const [step, setStep] = useState<"idle" | "sure">("idle");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section
      id="review"
      aria-labelledby="review-heading"
      className="border-warning/40 bg-surface scroll-mt-20 rounded-lg border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="review-heading" className="text-sm font-semibold">
            Needs your review
            <span className="text-warning ml-2 font-mono text-xs font-normal">{items.length}</span>
          </h3>
          <p className="text-muted mt-1 max-w-xl text-sm">
            These came from your resume. Read each one: fix anything the parser got wrong, then
            confirm it. Only confirmed items count as verified and can be used in anything HireOS
            writes for you.
          </p>
        </div>
        {step === "idle" ? (
          <Button variant="secondary" size="sm" onClick={() => setStep("sure")}>
            Confirm all {items.length}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs">I have read every item.</span>
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await confirmAllAction();
                  setMessage(r.ok ? (r.message ?? "Confirmed.") : r.error);
                  setStep("idle");
                })
              }
            >
              {pending ? "Confirming…" : "Yes, confirm all"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep("idle")}>
              Not yet
            </Button>
          </div>
        )}
      </div>
      {message && (
        <p role="status" className="text-muted mt-2 text-sm">
          {message}
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((p) => (
          <Row key={`${p.entity}-${p.item.id}`} {...p} />
        ))}
      </ul>
    </section>
  );
}
