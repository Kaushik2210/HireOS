/** Declarative description of one form field, rendered by EntityForm. */
export type FieldDef = { name: string; label: string; hint?: string; placeholder?: string } & (
  | { kind: "text" | "url" | "month" | "number" | "checkbox" }
  | { kind: "textarea"; rows?: number }
  | { kind: "select"; options: readonly { value: string; label: string }[]; allowEmpty?: boolean }
  | { kind: "checkboxes"; options: readonly { value: string; label: string }[] }
  | { kind: "list"; mode: "lines" | "commas" }
);
