const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "ref",
  "referrer",
  "source",
  "src",
  "trk",
  "trkid",
  "gh_src",
  "gh_jid_src",
  "lever-source",
  "lever-origin",
  "mc_cid",
  "mc_eid",
  "igshid",
]);

/**
 * The link a person would open to apply, with tracking parameters and fragments removed.
 * Returns null for anything that is not a plain http(s) URL, which also blocks javascript:
 * and data: links from ever becoming an href.
 */
export function canonicalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null; // credentials in a link are never legitimate here

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept = [...url.searchParams.entries()]
    .filter(
      ([key]) => !key.toLowerCase().startsWith("utm_") && !TRACKING_PARAMS.has(key.toLowerCase()),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  // "/apply/42/" and "/apply/42" are the same page.
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const result = url.toString();
  return result.length <= 500 ? result : null;
}
