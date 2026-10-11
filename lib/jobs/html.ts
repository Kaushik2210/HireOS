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

// A line break: <br>, or the end of a paragraph, division, heading, row or list.
const BREAK_TAG = /^<\s*(?:br\b|\/\s*(?:p|div|h[1-6]|tr|ul|ol|section)\b)/i;
const LIST_ITEM_TAG = /^<\s*li\b/i;
const RAW_TEXT_TAG = /^<(script|style)\b/i;
const TAG_START = /^<\/?[a-z]/i;

/**
 * Removes tags in one pass over the text. Each position is looked at a bounded number of
 * times, so a long run of unclosed "<" or "<script" cannot make the cost grow with the
 * square of the length, as patterns like /<[^>]*>/ and /<script[\s\S]*?<\/script>/ do on
 * hostile input.
 *
 * With `anyBracket`, every "<" that has a matching ">" is treated as a tag. Without it, only
 * "<" followed by a letter or "/" is (used after entities are decoded, so ordinary text such
 * as "a < b" survives).
 */
function stripTags(input: string, anyBracket: boolean): string {
  const lower = input.toLowerCase();
  let out = "";
  let i = 0;
  // Position of the next ">" at or after the cursor; -1 once there is none left.
  let nextClose = -2;

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, lt);

    // Comments run to "-->", or to the end of the text if never closed (as a browser reads it).
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      out += " ";
      i = end === -1 ? input.length : end + 3;
      continue;
    }

    if (nextClose === -2 || (nextClose !== -1 && nextClose < lt)) {
      nextClose = input.indexOf(">", lt);
    }
    if (nextClose === -1) {
      // No ">" anywhere after this point, so nothing below can be a tag.
      out += input.slice(lt);
      break;
    }

    const tag = input.slice(lt, nextClose + 1);
    if (!anyBracket && !TAG_START.test(tag)) {
      out += "<";
      i = lt + 1;
      continue;
    }

    const raw = RAW_TEXT_TAG.exec(tag);
    if (raw) {
      const closer = lower.indexOf("</" + raw[1]!.toLowerCase(), nextClose + 1);
      out += " ";
      if (closer === -1) {
        // Never closed: the rest is script or style text, which is not content.
        i = input.length;
        continue;
      }
      const end = input.indexOf(">", closer);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    if (BREAK_TAG.test(tag)) out += "\n";
    else if (LIST_ITEM_TAG.test(tag)) out += "\n• ";
    else out += " ";
    i = nextClose + 1;
  }
  return out;
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

  s = stripTags(s, true);

  // Anything that still looks like a tag after decoding is removed too.
  s = stripTags(decodeEntities(s), false);

  return (
    s
      // Control characters (NUL especially) cannot be stored and are never meaningful text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .split("\n")
      .map((line) => line.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
