"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_BYTES = 4 * 1024 * 1024;

/** Quick feedback only. The server re-checks everything, by content, not by name. */
export function clientCheck(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc") || name.endsWith(".rtf") || name.endsWith(".odt")) {
    return "Please save your resume as a PDF or a .docx file and upload that.";
  }
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return "Upload a PDF or a .docx file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return "That file is larger than 4 MB.";
  return null;
}

type State =
  { kind: "idle" } | { kind: "uploading"; name: string } | { kind: "error"; message: string };

export function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    const problem = clientCheck(file);
    if (problem) {
      setState({ kind: "error", message: problem });
      return;
    }
    setState({ kind: "uploading", name: file.name });
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/resumes", { method: "POST", body });
      const result = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok || !result?.id) {
        setState({
          kind: "error",
          message: result?.error ?? "The upload failed. Please try again.",
        });
        return;
      }
      router.push(`/resume/${result.id}`);
    } catch {
      setState({
        kind: "error",
        message: "Could not reach the server. Check your connection and try again.",
      });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  const uploading = state.kind === "uploading";

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !uploading) void upload(file);
        }}
        className={cn(
          "border-border-strong focus-within:border-accent relative rounded-lg border border-dashed p-8 text-center transition-colors",
          dragging && "border-accent bg-accent-soft",
        )}
      >
        <input
          ref={input}
          id="resume-file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={uploading}
          className="peer sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <label
          htmlFor="resume-file"
          className="flex cursor-pointer flex-col items-center gap-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--accent)] peer-disabled:cursor-wait"
        >
          {uploading ? (
            <Loader2 className="text-accent size-6 animate-spin" aria-hidden="true" />
          ) : (
            <FileUp className="text-subtle size-6" aria-hidden="true" />
          )}
          <span className="text-sm font-medium">
            {uploading ? `Analysing ${state.name}…` : "Choose a resume, or drop it here"}
          </span>
          <span className="text-muted text-xs">
            PDF or .docx, up to 4 MB, text-based (not a scan)
          </span>
        </label>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {uploading ? "Uploading and analysing your resume" : ""}
      </p>
      {state.kind === "error" && (
        <p
          role="alert"
          className="border-danger/40 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
