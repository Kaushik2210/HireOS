import { createRateLimiter } from "@/lib/rate-limit";

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Credential-stuffing brakes. Per instance; see lib/rate-limit.ts.
export const signInByIp = createRateLimiter({ limit: 20, windowMs: FIFTEEN_MIN });
export const signInByEmail = createRateLimiter({ limit: 6, windowMs: FIFTEEN_MIN });
export const signUpByIp = createRateLimiter({ limit: 5, windowMs: ONE_HOUR });
export const resetByIp = createRateLimiter({ limit: 10, windowMs: ONE_HOUR });
export const resetByEmail = createRateLimiter({ limit: 3, windowMs: ONE_HOUR });
