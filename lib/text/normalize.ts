const BULLET_CHARS = "•◦▪▫■□●○◆◇‣⁃∙·➢➤►▸❖✓✔*-–—";
const BULLET_LINE = new RegExp(`^[${BULLET_CHARS.replace(/[-\]\\^]/g, "\\$&")}]\\s+(?=\\S)`);

// Built from code points so the invisible characters stay readable in source.
const ZERO_WIDTH = new RegExp(
  `[${["\\u200b", "\\u200c", "\\u200d", "\\u2060", "\\ufeff"].join("")}]`,
  "g",
);
const EXOTIC_SPACES = new RegExp(
  `[${["\\u00a0", "\\u2000-\\u200a", "\\u202f", "\\u205f", "\\u3000"].join("")}]`,
  "g",
);
const CONTROL_CHARS = new RegExp(
  `[${["\\u0000-\\u0008", "\\u000b", "\\u000c", "\\u000e-\\u001f", "\\u007f"].join("")}]`,
  "g",
);

/**
 * Cleans extracted text so later stages can rely on it: compatibility-normalised Unicode
 * (ligatures, full-width forms), one bullet glyph, no invisible characters, tidy blank lines.
 */
export function normalizeText(raw: string): string {
  const text = raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(EXOTIC_SPACES, " ")
    .replace(CONTROL_CHARS, "") // everything except tab and newline
    .replace(/\r\n?/g, "\n");

  const lines = text.split("\n").map((line) => {
    const trimmed = line.replace(/[ \t]+/g, " ").trim();
    // A leading dash only counts as a bullet when followed by a space (handled by BULLET_LINE).
    return BULLET_LINE.test(trimmed) ? trimmed.replace(BULLET_LINE, "• ") : trimmed;
  });

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
