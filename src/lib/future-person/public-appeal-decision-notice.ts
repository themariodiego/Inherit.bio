import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAppealIntakeRuntime } from "./appeal-intake-runtime";
import { testAppealIntakeOpen } from "./appeals-open";
import { publicAppealSessionHash } from "./public-appeal-session";
import { openAppealDecisionNotice } from "./public-appeal-review";

export type PublicAppealDecisionNotice = NonNullable<ReturnType<typeof openAppealDecisionNotice>>;

/** The native reader selects the exact original recipient and notice purpose.
 * Decryption is only a consistency check; it never establishes authority.
 * Reading does not renew the notice, intake, session or original case clock. */
export async function loadPublicAppealDecisionNotice(request: Request): Promise<PublicAppealDecisionNotice | null> {
 if (!testAppealIntakeOpen() || new URL(request.url).search) return null;
 const hash = publicAppealSessionHash(request); if (!hash) return null;
 const owner = createAppealIntakeRuntime(request.signal);
 let notice: PublicAppealDecisionNotice | null = null;
 try {
  const { data, error } = await owner.wait(owner.read(() => createAdminClient()
   .rpc("read_public_appeal_decision_notice_v1", { p_session_hash: hash }).retry(false).abortSignal(owner.signal)));
  if (!error) {
   const opened = openAppealDecisionNotice(data);
   if (opened && opened.decisions.length > 0 && Date.parse(opened.deadline) > Date.now()) notice = opened;
  }
 } catch { /* An unavailable or uncertain native read exposes no notice. */ }
 finally { await owner.finish(); }
 const settled = owner.disposition();
 return settled.cleanupHeld || settled.pendingActualTasks !== 0 || settled.ownedMutableBuffers !== 0 ? null : notice;
}
