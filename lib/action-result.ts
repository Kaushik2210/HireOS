/** Result shape returned by server actions. Redirects never return. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Converts a Zod error into the field-level shape the forms render. */
export function invalidResult(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}): ActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(error.flatten().fieldErrors)) {
    if (messages) fieldErrors[key] = messages;
  }
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}
