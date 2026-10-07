import { z } from "zod";

/* Field helpers shared by every Zod schema in the app. */

/** Optional text: trims, turns blank into null, caps length. */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);

/** Only http(s) links; blocks javascript: and data: URLs that could be rendered as hrefs. */
export const url = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters")
  .nullish()
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || /^https?:\/\/[^\s]+$/i.test(v),
    "Enter a link starting with http:// or https://",
  );

/** A list of short strings: trimmed, bounded, de-duplicated. */
export const list = (maxItems: number, maxLength: number) =>
  z
    .array(
      z.string().trim().min(1).max(maxLength, `Each entry can be at most ${maxLength} characters`),
    )
    .max(maxItems, `Add at most ${maxItems} entries`)
    .default([])
    .transform((items) => [...new Set(items)]);
