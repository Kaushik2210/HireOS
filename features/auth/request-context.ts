import { headers } from "next/headers";
import { getServerEnv } from "@/lib/env";

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

/** Public origin used in email links. Required in production so links cannot be spoofed via Host. */
export function getAppUrl(): string | null {
  const configured = getServerEnv().APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}
