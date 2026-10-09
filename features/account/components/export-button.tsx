"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-field";

/** Asks the server for the export and saves it as a file; shows a plain message on failure. */
export function ExportButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function download() {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const response = await fetch("/api/account/export", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not build your export. Please try again.");
        return;
      }
      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
        "hireos-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="primary" onClick={download} disabled={pending}>
          <Download />
          {pending ? "Preparing…" : "Download my data"}
        </Button>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {done && <FormMessage tone="info">Your export was saved as a file.</FormMessage>}
    </div>
  );
}
