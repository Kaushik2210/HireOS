import { describe, expect, it } from "vitest";
import { getCapabilities, parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("accepts an empty environment (demo mode needs no keys)", () => {
    expect(() => parseServerEnv({})).not.toThrow();
  });

  it("treats empty strings from .env.example as unset", () => {
    const env = parseServerEnv({ ANTHROPIC_API_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "  " });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it("rejects an invalid Supabase URL and names the variable, not the value", () => {
    const attempt = () => parseServerEnv({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url-secret" });
    expect(attempt).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(attempt).not.toThrow(/not-a-url-secret/);
  });
});

describe("getCapabilities", () => {
  it("reports demo mode with nothing configured", () => {
    expect(getCapabilities(parseServerEnv({}))).toEqual({
      supabase: false,
      llm: false,
      email: false,
      backgroundJobs: false,
      serviceRole: false,
      demoMode: true,
    });
  });

  it("requires both Supabase URL and anon key", () => {
    const urlOnly = parseServerEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });
    expect(getCapabilities(urlOnly).supabase).toBe(false);

    const both = parseServerEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    const caps = getCapabilities(both);
    expect(caps.supabase).toBe(true);
    expect(caps.demoMode).toBe(false);
  });

  it("enables the LLM only when an API key is present", () => {
    expect(getCapabilities(parseServerEnv({ ANTHROPIC_API_KEY: "k" })).llm).toBe(true);
    expect(getCapabilities(parseServerEnv({})).llm).toBe(false);
  });

  it("requires both Inngest keys for background jobs", () => {
    expect(getCapabilities(parseServerEnv({ INNGEST_EVENT_KEY: "a" })).backgroundJobs).toBe(false);
    expect(
      getCapabilities(parseServerEnv({ INNGEST_EVENT_KEY: "a", INNGEST_SIGNING_KEY: "b" }))
        .backgroundJobs,
    ).toBe(true);
  });
});
