import "server-only";

import { keyedDigestSet } from "@/lib/hmac-keyring";

/**
 * The bucket key for lifecycleDispositionContracts.global-contact-refusal-bar-v1
 * .quotaAuthority.perActingAccount, keyed under every rate-limit revision this
 * deployment holds. The ceilings (10 attempts an hour, 30 a UTC day) and the
 * counting live in the invitation RPCs, which refuse a call without this key;
 * the route can neither skip nor loosen them.
 *
 * Only digests leave this function. The account id is namespaced by operation
 * and dimension before keying, so the digest matches no other operation's
 * bucket.
 *
 * The register's per-source-network bucket is not keyed here: reading the
 * client address is forbidden by `scripts/jurisdiction-inference.test.ts`
 * (G5.1a) outside the one sanctions check, and widening that exception is an
 * owner decision (docs/rights-invitation-flow.md).
 */
export const INVITATION_ATTEMPT_OPERATION = "global-contact-refusal-bar-v1.invitation-attempt";

export type InvitationQuotaKeys = Record<string, Record<"authenticated-principal", string>>;

export function invitationQuotaKeys(accountId: string): InvitationQuotaKeys {
  const account = keyedDigestSet("rate-limit", `${INVITATION_ATTEMPT_OPERATION}|authenticated-principal|${accountId}`);
  const keys: InvitationQuotaKeys = {};
  for (const [revision, digest] of Object.entries(account)) {
    keys[revision] = { "authenticated-principal": digest };
  }
  return keys;
}
