import { createRateLimiter } from "@/lib/rate-limit";

const ONE_HOUR = 60 * 60 * 1000;

// Parsing a file is the most CPU-expensive thing a user can trigger, so it is limited per
// person and per address. In memory, per instance; see lib/rate-limit.ts.
export const uploadByUser = createRateLimiter({ limit: 15, windowMs: ONE_HOUR });
export const uploadByIp = createRateLimiter({ limit: 40, windowMs: ONE_HOUR });
