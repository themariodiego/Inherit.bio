import "server-only";

import { keyedDigestSet } from "@/lib/hmac-keyring";
import { sourceNetwork } from "@/lib/source-network";

/**
 * The bucket keys for lifecycleDispositionContracts.global-contact-refusal-bar-v1
 * .quotaAuthority: one per acting account and one per source network, each
 * keyed under every rate-limit revision this deployment holds. The ceilings
 * (10 attempts an hour and 30 a UTC day per account, 30 an hour per network)
 * and the counting live in the invitation RPCs, which refuse a call without
 * these keys; the route can neither skip nor loosen them.
 *
 * Only digests leave this function. The account id and the network are
 * namespaced by operation and dimension before keying, so neither digest can
 * match another operation's bucket or the other dimension. The network is
 * read only for this (owner decision, 28 September 2026) and never reaches a
 * jurisdiction decision.
 */
export const INVITATION_ATTEMPT_OPERATION = "global-contact-refusal-bar-v1.invitation-attempt";

type Dimension = "authenticated-principal" | "source-network";
export type InvitationQuotaKeys = Record<string, Record<Dimension, string>>;

export function invitationQuotaKeys(accountId: string, headers: Headers): InvitationQuotaKeys {
  const account = keyedDigestSet("rate-limit", `${INVITATION_ATTEMPT_OPERATION}|authenticated-principal|${accountId}`);
  const network = keyedDigestSet("rate-limit", `${INVITATION_ATTEMPT_OPERATION}|source-network|${sourceNetwork(headers)}`);
  const keys: InvitationQuotaKeys = {};
  for (const revision of Object.keys(account)) {
    keys[revision] = {
      "authenticated-principal": account[revision]!,
      "source-network": network[revision]!,
    };
  }
  return keys;
}
