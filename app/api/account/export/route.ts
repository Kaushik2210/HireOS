import { NextResponse, type NextRequest } from "next/server";
import { getApplicationStore } from "@/db/applications";
import { getDocumentStore } from "@/db/documents";
import { getInterviewStore } from "@/db/interviews";
import { getJobStore } from "@/db/jobs";
import { getOutreachStore } from "@/db/outreach";
import { getPracticeStore } from "@/db/practice";
import { getProfileStore } from "@/db/profile";
import { getResumeStore } from "@/db/resume";
import { getCurrentUser } from "@/lib/auth/session";
import { createSharedLimiter } from "@/lib/security/limits";
import { isSameOrigin } from "@/lib/security/origin";
import { buildAccountExport } from "@/services/account/export";
import { loadSecurityEvents } from "@/services/account/security-events";
import { recordAudit } from "@/services/audit";

export const runtime = "nodejs";

// Gathering everything is the heaviest read a person can trigger.
const exportByUser = createSharedLimiter({ name: "exportByUser", limit: 5, windowMs: 3_600_000 });

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const fail = (error: string, code: string, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json({ error, code }, { status, headers: { ...headers, ...extra } });

/** POST, not GET, so a link on another site cannot make a browser download someone's data. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return fail("Cross-site requests are not allowed.", "origin", 403);

  const user = await getCurrentUser();
  if (!user) return fail("Please sign in again.", "auth", 401);

  const limit = await exportByUser.check(user.id);
  if (!limit.ok) {
    return fail("Too many exports. Please wait a while and try again.", "rate_limit", 429, {
      "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
    });
  }

  try {
    const [profile, resumes, jobs, documents, outreach, applications, interviews, practice] =
      await Promise.all([
        getProfileStore(user),
        getResumeStore(user),
        getJobStore(user),
        getDocumentStore(user),
        getOutreachStore(user),
        getApplicationStore(user),
        getInterviewStore(user),
        getPracticeStore(user),
      ]);
    const data = await buildAccountExport(
      user,
      { profile, resumes, jobs, documents, outreach, applications, interviews, practice },
      await loadSecurityEvents(user, 200),
    );
    await recordAudit("account.exported", user.isDemo ? null : user.id);
    const stamp = data.exported_at.slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="hireos-export-${stamp}.json"`,
      },
    });
  } catch {
    return fail("Could not build your export. Please try again.", "export_failed", 500);
  }
}
