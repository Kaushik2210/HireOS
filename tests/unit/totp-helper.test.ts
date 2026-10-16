// @vitest-environment node
import { describe, expect, it } from "vitest";
import { totpCode } from "../live/totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (base32 below), 8-digit values
// truncated to the last six digits that a 6-digit code would show.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("the test TOTP generator", () => {
  it("matches the published RFC 6238 vectors", () => {
    expect(totpCode(SECRET, 59_000)).toBe("287082");
    expect(totpCode(SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(SECRET, 1_111_111_111_000)).toBe("050471");
    expect(totpCode(SECRET, 1_234_567_890_000)).toBe("005924");
    expect(totpCode(SECRET, 2_000_000_000_000)).toBe("279037");
  });

  it("changes every thirty seconds and reaches adjacent windows", () => {
    const t = 1_700_000_000_000;
    expect(totpCode(SECRET, t)).toBe(totpCode(SECRET, t + 5_000));
    expect(totpCode(SECRET, t, 1)).toBe(totpCode(SECRET, t + 30_000));
    expect(totpCode(SECRET, t, -1)).toBe(totpCode(SECRET, t - 30_000));
  });

  it("accepts a secret with spaces and lower case, as apps display them", () => {
    expect(totpCode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000)).toBe("287082");
  });
});
