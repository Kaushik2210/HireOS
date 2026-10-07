import { getDocumentStore } from "@/db/documents";
import type { DocumentVersion } from "@/db/documents/store";
import { getJobStore } from "@/db/jobs";
import { getProfileStore } from "@/db/profile";
import type { ProfileSnapshot } from "@/db/profile/store";
import type { AuthUser } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/schemas";
import type { DocumentKind } from "@/lib/tailoring/types";
import { buildCandidate } from "@/services/matching/candidate";
import { pendingCount } from "@/services/profile/verified";

export interface TailorContext {
  job: Job | null;
  snapshot: ProfileSnapshot;
  pending: number;
  profileHash: string;
  versions: DocumentVersion[];
}

/** Everything a tailoring page needs, read once. `job` is null when it does not exist or is not visible. */
export async function loadTailorContext(
  user: AuthUser,
  jobId: string,
  kind?: DocumentKind,
): Promise<TailorContext> {
  const [job, snapshot, versions] = await Promise.all([
    getJobStore(user).then((s) => s.get(user.id, jobId)),
    getProfileStore(user).then((s) => s.getSnapshot(user.id)),
    getDocumentStore(user).then((s) => s.list(user.id, { jobId, kind })),
  ]);
  return {
    job,
    snapshot,
    pending: pendingCount(snapshot),
    profileHash: buildCandidate(snapshot).hash,
    versions,
  };
}
