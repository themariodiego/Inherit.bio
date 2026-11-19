import "server-only";

import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { mintAccountOperationNonce } from "@/lib/account-operation-nonce";

/**
 * What `/settings/consents` renders for the revoke-all control: the one-time
 * account operation nonce of `consents_revoke_all` for the live account and
 * auth session, or null when there is none. Pure apart from the read of the
 * current session: it stores nothing, and only the POST to
 * `/api/consents/revoke-all` consumes the nonce.
 */
export async function revokeAllControlNonce(now = Date.now()): Promise<string | null> {
  const context = await getSensitiveAccountContext();
  if (!context) return null;
  return mintAccountOperationNonce({ accountId: context.user.id, sessionId: context.sessionId,
    operation: "consents_revoke_all" }, now);
}
