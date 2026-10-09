export interface AdminClient {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number },
      ): PromiseLike<{ data: { name: string }[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  auth: {
    admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> };
  };
}

export type DeleteOutcome = "deleted" | "failed";

const BUCKET = "resumes";

/**
 * Permanently deletes an account and everything attached to it.
 *
 * Uploaded files go first: they live in storage, which the database cascade cannot reach, and
 * once the account is gone nothing could find them again. If removing a file fails the
 * account is left alone, so the person can simply try again. Deleting the auth user then
 * cascades to every table (profile, resumes, jobs, drafts, applications, interviews and so
 * on). The audit trail keeps its rows with the user detached, so no personal data remains.
 *
 * Needs the service role: nothing a signed-in user can do can delete their own auth record.
 */
export async function deleteAccount(userId: string, admin: AdminClient): Promise<DeleteOutcome> {
  try {
    const files = admin.storage.from(BUCKET);
    // A person is capped at a handful of resumes, so one page holds everything; the loop only
    // matters if that cap is ever raised.
    for (let round = 0; round < 10; round++) {
      const listed = await files.list(userId, { limit: 1000 });
      if (listed.error) return "failed";
      const names = listed.data ?? [];
      if (names.length === 0) break;
      const removed = await files.remove(names.map((f) => `${userId}/${f.name}`));
      if (removed.error) return "failed";
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    return error ? "failed" : "deleted";
  } catch {
    return "failed";
  }
}
