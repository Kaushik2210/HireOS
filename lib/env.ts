import { z } from "zod";

// Empty strings (as in .env.example) count as "not set".
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const optionalUrl = optionalString.pipe(z.url().optional());

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  /** Public origin of the app, used to build email-link redirects. */
  APP_URL: optionalUrl,
});

export type ServerEnv = z.infer<typeof serverSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) {
    // Report variable names only; never echo values, they may be secrets.
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Server-side only. Evaluated lazily so the app boots with no keys at all. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export interface Capabilities {
  supabase: boolean;
  llm: boolean;
  email: boolean;
  backgroundJobs: boolean;
  /** Server-only admin client available (audit logging, ingestion). */
  serviceRole: boolean;
  /** True when no backing service is configured: the app runs on demo data. */
  demoMode: boolean;
}

export function getCapabilities(env: ServerEnv = getServerEnv()): Capabilities {
  const supabase = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return {
    supabase,
    llm: Boolean(env.ANTHROPIC_API_KEY),
    email: Boolean(env.RESEND_API_KEY),
    backgroundJobs: Boolean(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY),
    serviceRole: supabase && Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    demoMode: !supabase,
  };
}
