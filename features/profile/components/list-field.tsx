"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/form-field";

export function parseList(text: string, mode: "lines" | "commas"): string[] {
  return text
    .split(mode === "lines" ? /\r?\n/ : ",")
    .map((part) => part.trim())
    .filter(Boolean);
}

interface ListFieldProps {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  mode: "lines" | "commas";
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * Edits a list of strings as plain text (one per line, or comma separated).
 * Keeps its own raw text so typing a trailing newline or comma is not eaten by parsing.
 */
export function ListField({ value, onChange, mode, ...props }: ListFieldProps) {
  const [text, setText] = useState(() => value.join(mode === "lines" ? "\n" : ", "));
  const handle = (next: string) => {
    setText(next);
    onChange(parseList(next, mode));
  };

  return mode === "lines" ? (
    <Textarea {...props} rows={5} value={text} onChange={(e) => handle(e.target.value)} />
  ) : (
    <Input {...props} value={text} onChange={(e) => handle(e.target.value)} />
  );
}
