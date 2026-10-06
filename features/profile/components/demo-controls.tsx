"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-field";
import { loadDemoPersonaAction, wipeDemoDataAction } from "@/features/profile/actions";

interface DemoControlsProps {
  personas: { id: string; label: string }[];
}

export function DemoControls({ personas }: DemoControlsProps) {
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const result = await task();
      setStatus(result.ok ? done : (result.error ?? "Something went wrong."));
    });

  return (
    <section
      aria-labelledby="demo-heading"
      className="border-accent/30 bg-accent-soft rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="accent">Demo data</Badge>
        <h3 id="demo-heading" className="text-sm font-medium">
          You are viewing a fictional candidate
        </h3>
      </div>
      <p className="text-muted mt-1 text-sm">
        Everything here is invented and private to your browser session. Switch candidates, or wipe
        it to start from a blank profile.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="persona" className="sr-only">
          Demo candidate
        </label>
        <Select
          id="persona"
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          className="w-auto max-w-full min-w-56"
          disabled={pending}
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => loadDemoPersonaAction(personaId), "Demo candidate loaded.")}
        >
          Load candidate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => wipeDemoDataAction(), "Demo data wiped. Start from scratch below.")
          }
        >
          Wipe demo data
        </Button>
      </div>
      <p role="status" className="text-muted mt-2 text-xs empty:hidden">
        {status}
      </p>
    </section>
  );
}
