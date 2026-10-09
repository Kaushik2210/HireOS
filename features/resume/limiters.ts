import { createSharedLimiter } from "@/lib/security/limits";

const ONE_HOUR = 60 * 60 * 1000;

// Parsing a file is the most CPU-expensive thing a user can trigger, so it is limited per
// person and per address. Shared across instances when the database is configured; see lib/security/limits.ts.
export const uploadByUser = createSharedLimiter({
  name: "uploadByUser",
  limit: 15,
  windowMs: ONE_HOUR,
});
export const uploadByIp = createSharedLimiter({
  name: "uploadByIp",
  limit: 40,
  windowMs: ONE_HOUR,
});
