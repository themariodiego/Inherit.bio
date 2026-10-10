import "server-only";

import type {DigestSet} from "@/lib/hmac-keyring";
import {appealKeyedDigests as keyedDigestSet} from "@/lib/future-person/appeal-keyed-digests";
import { sourceNetwork } from "@/lib/source-network";

/**
 * Bucket keys for the securityRateLimitContract limits the database enforces.
 * Every value is namespaced by its registered operation and dimension, then
 * keyed under each rate-limit revision this deployment holds; only digests
 * leave this module. The ceilings and the counting live in the RPCs, which
 * refuse a call without these keys, so a route can neither skip nor loosen
 * them.
 *
 * This is the only module that may read the client's source network (owner
 * decision, 28 September 2026): `networkBucketDigests` is its one use, and
 * `scripts/jurisdiction-inference.test.ts` fails any other. The network is
 * never used to decide a jurisdiction.
 */

/** The registered operations whose limits include a per-network bucket. */
export type NetworkLimitedOperation =
  | "global-contact-refusal-bar-v1.invitation-attempt"
  | "api.future-person-claim"
  | "api.subject-access-request";

export const INVITATION_ATTEMPT_OPERATION = "global-contact-refusal-bar-v1.invitation-attempt";
export const CLAIM_START_OPERATION = "api.future-person-claim";

/** The request's source network, keyed for one operation's network bucket. */
export function networkBucketDigests(operation: NetworkLimitedOperation, headers: Headers): DigestSet {
  return keyedDigestSet("rate-limit", `${operation}|source-network|${sourceNetwork(headers)}`);
}

type InvitationDimension = "authenticated-principal" | "source-network";
export type InvitationQuotaKeys = Record<string, Record<InvitationDimension, string>>;

/**
 * global-contact-refusal-bar-v1.quotaAuthority: one key per acting account
 * and one per source network (10 an hour and 30 a UTC day per account, 30 an
 * hour per network).
 */
export function invitationQuotaKeys(accountId: string, headers: Headers): InvitationQuotaKeys {
  const account = keyedDigestSet("rate-limit", `${INVITATION_ATTEMPT_OPERATION}|authenticated-principal|${accountId}`);
  const network = networkBucketDigests(INVITATION_ATTEMPT_OPERATION, headers);
  const keys: InvitationQuotaKeys = {};
  for (const revision of Object.keys(account)) {
    keys[revision] = {
      "authenticated-principal": account[revision]!,
      "source-network": network[revision]!,
    };
  }
  return keys;
}

/**
 * api.future-person-claim.policy.abuseControls.identifier: the submitted key,
 * or for a keyless start the normalized contact, together with the mode. The
 * raw value is never stored; the database sees this digest only.
 */
export function claimIdentifierDigests(mode: string, identifier: string): DigestSet {
  return keyedDigestSet("rate-limit", `${CLAIM_START_OPERATION}|identifier|${mode}|${identifier}`);
}
