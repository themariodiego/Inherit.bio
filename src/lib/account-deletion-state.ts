import "server-only";

import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { mintAccountOperationNonce } from "@/lib/account-operation-nonce";
import { createAdminClient } from "@/lib/supabase/admin";

export type DeletionControlState =
  | Readonly<{ status: "active"; operationNonce: string }>
  | Readonly<{ status: "notice_period"; noticeEndsAt: string; operationNonce: string }>;

/**
 * What `/settings/data` renders for the deletion control, brief X1.5. A
 * read-only check (the live account and auth session, and the current
 * deletion request) followed by a stateless nonce for the one operation that
 * state offers. It writes nothing: no nonce row, no session, no cookie.
 * Re-authentication within 15 minutes and MFA are checked by the POST that
 * consumes the nonce, not here, so the page can always show the status.
 */
export async function deletionControlState(now = Date.now()): Promise<DeletionControlState | null> {
  const context = await getSensitiveAccountContext();
  if (!context) return null;
  const { data: active, error } = await createAdminClient()
    .from("account_deletion_requests")
    .select("id,state,notice_ends_at")
    .eq("account_id", context.user.id)
    .in("state", ["notice_period", "delete_started"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const binding = { accountId: context.user.id, sessionId: context.sessionId };
  return active
    ? { status: "notice_period", noticeEndsAt: active.notice_ends_at,
        operationNonce: mintAccountOperationNonce({ ...binding, operation: "account_delete_cancel" }, now) }
    : { status: "active", operationNonce: mintAccountOperationNonce({ ...binding, operation: "account_delete" }, now) };
}
