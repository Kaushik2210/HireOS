import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getResumeStore } from "@/db/resume";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * Downloads go through a short-lived signed URL from private storage. The file is never
 * served from this origin, so an uploaded document cannot run in the app's context.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new NextResponse("Not found", { status: 404, headers: noStore });

  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401, headers: noStore });

  const url = await (await getResumeStore(user)).signedUrl(user.id, id.data);
  if (!url) return new NextResponse("Not found", { status: 404, headers: noStore });

  return NextResponse.redirect(url, { status: 302, headers: noStore });
}
