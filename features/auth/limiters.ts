import { createSharedLimiter } from "@/lib/security/limits";

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Credential-stuffing brakes. Shared across instances when the database is configured;
// see lib/security/limits.ts.
export const signInByIp = createSharedLimiter({
  name: "signInByIp",
  limit: 20,
  windowMs: FIFTEEN_MIN,
});
export const signInByEmail = createSharedLimiter({
  name: "signInByEmail",
  limit: 6,
  windowMs: FIFTEEN_MIN,
});
export const signUpByIp = createSharedLimiter({ name: "signUpByIp", limit: 5, windowMs: ONE_HOUR });
export const resetByIp = createSharedLimiter({ name: "resetByIp", limit: 10, windowMs: ONE_HOUR });
export const resetByEmail = createSharedLimiter({
  name: "resetByEmail",
  limit: 3,
  windowMs: ONE_HOUR,
});
