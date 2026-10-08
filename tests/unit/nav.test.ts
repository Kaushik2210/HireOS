import { describe, expect, it } from "vitest";
import { NAV_ITEMS, PALETTE_ACTIONS } from "@/lib/nav";
import { cn } from "@/lib/utils";

describe("navigation registry", () => {
  it("has unique ids and hrefs", () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
  });

  it("only marks the built features as live", () => {
    const live = NAV_ITEMS.filter((i) => i.status === "live").map((i) => i.id);
    expect(live).toEqual([
      "dashboard",
      "profile",
      "resume",
      "jobs",
      "matches",
      "documents",
      "outreach",
      "applications",
      "interviews",
      "analytics",
      "gaps",
    ]);
  });

  it("never marks a palette action live without a destination", () => {
    for (const action of PALETTE_ACTIONS) {
      if (action.status === "live") expect(action.href).toBeTruthy();
    }
  });

  it("covers every palette action named in the product spec", () => {
    expect(PALETTE_ACTIONS).toHaveLength(9);
  });
});

describe("cn", () => {
  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
