import { NextResponse, type NextRequest } from "next/server";
import { getResumeStore } from "@/db/resume";
import { uploadByIp, uploadByUser } from "@/features/resume/limiters";
import { getCurrentUser } from "@/lib/auth/session";
import { MAX_UPLOAD_BYTES } from "@/lib/resume/constants";
import { isSameOrigin } from "@/lib/security/origin";
import { processResumeUpload } from "@/services/resume/upload";

// Parsing uses Node APIs (crypto, pdf.js), so this route must not run on the edge.
export const runtime = "nodejs";

/** Multipart overhead allowance on top of the file limit when judging Content-Length. */
const BODY_LIMIT = MAX_UPLOAD_BYTES + 64 * 1024;

const json = (
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-site requests are not allowed.", code: "origin" }, 403);
  }

  const user = await getCurrentUser();
  if (!user) return json({ error: "Please sign in again.", code: "auth" }, 401);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userLimit = uploadByUser.check(user.id);
  // Without a forwarded address (local runs) everyone would share one bucket, so only the
  // per-user limit applies. Deployed platforms always set the header.
  const ipLimit = ip ? uploadByIp.check(ip) : { ok: true, retryAfterMs: 0 };
  if (!userLimit.ok || !ipLimit.ok) {
    const retry = Math.ceil(Math.max(userLimit.retryAfterMs, ipLimit.retryAfterMs) / 1000);
    return json(
      { error: "Too many uploads. Please wait a while and try again.", code: "rate_limit" },
      429,
      { "Retry-After": String(retry) },
    );
  }

  // Refuse oversized bodies before reading them into memory.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > BODY_LIMIT) {
    return json({ error: "The file is larger than 4 MB.", code: "too_large" }, 413);
  }
  if (
    !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")
  ) {
    return json({ error: "Upload the file as form data.", code: "bad_request" }, 415);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "The upload could not be read.", code: "bad_request" }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: "Choose a file to upload.", code: "bad_request" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: "The file is larger than 4 MB.", code: "too_large" }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const store = await getResumeStore(user);
  const outcome = await processResumeUpload({ userId: user.id, bytes, fileName: file.name, store });

  if (!outcome.ok) return json({ error: outcome.message, code: outcome.code }, outcome.status);
  return json(
    { id: outcome.resume.id, duplicate: outcome.duplicate },
    outcome.duplicate ? 200 : 201,
  );
}
