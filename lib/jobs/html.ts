const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
};

/** Beyond this, input is cut off before any pattern runs. */
const MAX_INPUT = 200_000;

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return codePoint(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith("#")) return codePoint(parseInt(lower.slice(1), 10), whole);
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function codePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/**
 * Turns job-description markup into plain text. The result is only ever rendered as text,
 * never as HTML, and this removes markup anyway so stored data stays clean.
 *
 * Handles real HTML and the double-escaped form some feeds use ("&lt;p&gt;Hello&lt;/p&gt;").
 * Script and style bodies are dropped, list items become bullets, block boundaries become
 * line breaks, and entities are decoded. Plain text passes through unchanged.
 */
export function htmlToText(input: string): string {
  let s = input.slice(0, MAX_INPUT);

  // Double-escaped markup: unwrap one level so the tags below can be recognised.
  if (!/<[a-z!/]/i.test(s) && /&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);

  s = s
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/tr|\/ul|\/ol|\/section)\b[^>]*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]*>/g, " ");

  s = decodeEntities(s)
    // Anything that still looks like a tag after decoding is removed too.
    .replace(/<\/?[a-z][^>]*>/gi, " ");

  return (
    s
      // Control characters (NUL especially) cannot be stored and are never meaningful text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
