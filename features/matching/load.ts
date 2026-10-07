import { getProfileStore } from "@/db/profile";
import type { AuthUser } from "@/lib/auth/session";
import { buildCandidate, type Candidate } from "@/services/matching/candidate";
import { pendingCount } from "@/services/profile/verified";

export interface MatchContext {
  /** The verified profile prepared for scoring. Unconfirmed items never reach it. */
  candidate: Candidate;
  /** Items waiting for the user to confirm. They are not scored. */
  pending: number;
}

export async function loadMatchContext(user: AuthUser): Promise<MatchContext> {
  const snapshot = await (await getProfileStore(user)).getSnapshot(user.id);
  return { candidate: buildCandidate(snapshot), pending: pendingCount(snapshot) };
}
