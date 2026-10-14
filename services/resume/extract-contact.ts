import { matchHeading } from "@/services/resume/sections";

export interface Contact {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  website_url: string | null;
}

const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
const EMAIL_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/**
 * Finds the first email address by looking around each "@" instead of running a pattern
 * from every position. A scan like /[A-Za-z0-9._%+-]+@.../ restarts at each character of a
 * long unbroken word and takes time proportional to the square of its length.
 */
function findEmail(text: string): string | null {
  let at = text.indexOf("@");
  for (let tries = 0; at !== -1 && tries < 50; tries++) {
    let start = at;
    // A local part is at most 64 characters.
    while (start > 0 && at - start < 64 && EMAIL_LOCAL_CHAR.test(text[start - 1]!)) start--;
    const domain = EMAIL_DOMAIN.exec(text.slice(at + 1, at + 1 + 255));
    if (start < at && domain) return text.slice(start, at + 1) + domain[0];
    at = text.indexOf("@", at + 1);
  }
  return null;
}
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+(?=$|[\s|,;)])/i;
const WEBSITE = /(?:https?:\/\/|www\.)[^\s|,;)]+/i;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{8,16}\d/g;

const withScheme = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);
const trimTail = (value: string) => value.replace(/[.,;:]+$/, "");

function findPhone(text: string): string | null {
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, "");
    // 10 to 13 digits covers national numbers and country-coded ones, and rules out dates and ids.
    if (digits.length >= 10 && digits.length <= 13) return match[0].trim();
  }
  return null;
}

const NAME = /^[\p{L}][\p{L}.'’-]*(?: [\p{L}][\p{L}.'’-]*){0,4}$/u;

function looksLikeName(line: string): boolean {
  if (line.length < 3 || line.length > 60) return false;
  if (/[@\d]/.test(line) || /https?:|www\./i.test(line)) return false;
  if (matchHeading(line)) return false;
  if (/\b(resume|curriculum|vitae|cv|profile|summary)\b/i.test(line)) return false;
  return NAME.test(line);
}

const LOCATION = /^[\p{Lu}][\p{L} .'’-]+,\s*[\p{Lu}][\p{L} .'’-]+$/u;

/** Reads the block above the first section heading: name, email, phone, links, place. */
export function extractContact(headerLines: string[], fullText: string): Contact {
  const header = headerLines.join("\n");
  // Header first, then anywhere in the document as a fallback for odd layouts.
  const find = (re: RegExp) => re.exec(header)?.[0] ?? re.exec(fullText)?.[0] ?? null;

  const email = findEmail(header) ?? findEmail(fullText);
  const linkedin = find(LINKEDIN);
  const github = GITHUB.exec(header)?.[0] ?? null;

  let website: string | null = null;
  for (const m of header.matchAll(new RegExp(WEBSITE.source, "gi"))) {
    if (!/linkedin\.com|github\.com/i.test(m[0])) {
      website = m[0];
      break;
    }
  }

  const nameLine = headerLines.find(looksLikeName) ?? null;

  let location: string | null = null;
  for (const line of headerLines) {
    for (const piece of line.split(/\s*[|·•]\s*/)) {
      const candidate = piece.trim();
      if (candidate.length <= 60 && LOCATION.test(candidate)) {
        location = candidate;
        break;
      }
    }
    if (location) break;
  }

  return {
    full_name: nameLine,
    email,
    phone: findPhone(header) ?? findPhone(fullText),
    location,
    linkedin_url: linkedin ? withScheme(trimTail(linkedin)) : null,
    github_url: github ? withScheme(trimTail(github)) : null,
    website_url: website ? withScheme(trimTail(website)) : null,
  };
}
