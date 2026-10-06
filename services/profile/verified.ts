import type { ProfileSnapshot } from "@/db/profile/store";

/**
 * The integrity rule starts here: only confirmed items are verified, and only verified
 * items may be used as the source of any generated claim. Items proposed by the resume
 * parser stay out until the user confirms them.
 */
export function verifiedSnapshot(snapshot: ProfileSnapshot): ProfileSnapshot {
  return {
    ...snapshot,
    education: snapshot.education.filter((i) => i.confirmed),
    experiences: snapshot.experiences.filter((i) => i.confirmed),
    projects: snapshot.projects.filter((i) => i.confirmed),
    certifications: snapshot.certifications.filter((i) => i.confirmed),
    skills: snapshot.skills.filter((i) => i.confirmed),
    achievements: snapshot.achievements.filter((i) => i.confirmed),
  };
}

/** Number of items waiting for the user to confirm. */
export function pendingCount(snapshot: ProfileSnapshot): number {
  return (
    [
      snapshot.education,
      snapshot.experiences,
      snapshot.projects,
      snapshot.certifications,
      snapshot.skills,
      snapshot.achievements,
    ] as { confirmed: boolean }[][]
  ).reduce((total, items) => total + items.filter((i) => !i.confirmed).length, 0);
}
