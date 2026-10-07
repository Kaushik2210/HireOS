import { createHash } from "node:crypto";
import { companyKey, locationKey, titleKey } from "@/lib/jobs/keys";

/**
 * Identity of a posting independent of which source listed it. Two listings share a
 * fingerprint only when company, title and location all match after cleaning.
 */
export function jobFingerprint(input: {
  company_name: string;
  title: string;
  location?: string | null;
}): string {
  const key = [
    companyKey(input.company_name),
    titleKey(input.title),
    locationKey(input.location),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}
