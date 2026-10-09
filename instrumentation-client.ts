import { z } from "zod";

// Zod's just-in-time parser compiles validators with `new Function`, which the Content
// Security Policy forbids (the probe is reported as a violation even though it is caught).
// Turning it off in the browser costs nothing noticeable for form-sized inputs, and the
// server, which has no such policy, keeps the fast path. This runs before any schema is built.
z.config({ jitless: true });
