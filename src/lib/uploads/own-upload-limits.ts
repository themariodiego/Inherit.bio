import "server-only";

import { createAdminClient } from "../supabase/admin";
import { currentOwnUploadAccount } from "./own-upload-context";
import { ownUploadLimitsSchema, type OwnUploadLimits } from "./subject-upload-contract";

/**
 * The deployment's own-upload ceilings and this account's reserved total.
 *
 * These are deployment capacity read at request time, not a compiled-in
 * number: `src/lib/limits.ts` holds the older self-host display caps and is
 * not this authority. A disclosure outage returns null so the uploader keeps
 * working without a stated ceiling — it must never take the upload down.
 */
export async function readOwnUploadLimits(
  actor?: Awaited<ReturnType<typeof currentOwnUploadAccount>>,
): Promise<OwnUploadLimits | null> {
  try {
    const account = actor ?? await currentOwnUploadAccount();
    if (!account) return null;
    const { data, error } = await createAdminClient().rpc("own_upload_limits_v1", {
      p_account_id: account.accountId, p_session_id: account.sessionId,
    });
    if (error) return null;
    const parsed = ownUploadLimitsSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
