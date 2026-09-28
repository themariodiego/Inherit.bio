import "server-only";

import crypto from "node:crypto";
import { hmacSecret } from "@/lib/crypto";

/**
 * Versioned keyed digests the database matches but never computes.
 *
 * Two registered contracts rotate their keys without a gap:
 *
 *  - `contact` — lifecycleDispositionContracts.global-contact-refusal-bar-v1
 *    .barKeyring. A normalized address is keyed under every usable revision,
 *    so a refusal bar, pending invitation or rights session written under an
 *    older revision still matches while a newer one is active.
 *  - `rate-limit` — securityRateLimitContract.secretRotation. A bucket keeps
 *    counting under the revision it started under until its fixed purge.
 *
 * The database decides which revisions are usable (`private.hmac_key_versions`)
 * and refuses a request that is missing one, so this module always sends every
 * revision it holds and never has to know which one is active. A revision the
 * database has retired, or has not rotated to yet, is simply ignored there.
 *
 * Revision 1 is the digest this deployment has always computed, derived from
 * `BYOK_ENCRYPTION_KEY`, so nothing stored changes. Later revisions are
 * dedicated secrets in `INHERIT_HMAC_KEYRING`, written `2:<base64>,3:<base64>`,
 * each exactly 32 random bytes. `docs/rights-invitation-flow.md` has the
 * rotation runbook: the new secret is deployed before the database rotates.
 */

export type HmacKeyring = "contact" | "rate-limit";

/** `{"<revision>": "<64 lowercase hex>"}`, the shape the database resolves. */
export type DigestSet = Record<string, string>;

const LEGACY_CONTEXT: Record<HmacKeyring, string> = {
  contact: "contact-email-v1",
  "rate-limit": "security-rate-limit-v1",
};

interface RootKey {
  revision: number;
  key: Buffer;
}

const ENTRY = /^([1-9][0-9]{0,5}):([A-Za-z0-9+/_-]{43}={0,1})$/;

/**
 * The configured secrets for revisions 2 and later. A malformed value throws
 * rather than quietly dropping a revision: a missing revision would make the
 * database refuse every invitation, and a wrong one would match nothing.
 */
export function keyringRootKeys(setting: string | undefined): RootKey[] {
  if (setting === undefined || setting.trim() === "") return [];
  const revisions = new Set<number>();
  const keys = new Set<string>();
  return setting.split(",").map((raw) => {
    const match = ENTRY.exec(raw.trim());
    if (!match) {
      throw new Error("INHERIT_HMAC_KEYRING must be comma-separated revision:base64 entries");
    }
    const revision = Number(match[1]);
    const key = Buffer.from(match[2]!, "base64");
    if (revision < 2) {
      throw new Error("INHERIT_HMAC_KEYRING starts at revision 2; revision 1 is derived from BYOK_ENCRYPTION_KEY");
    }
    if (key.length !== 32) {
      throw new Error("INHERIT_HMAC_KEYRING keys must be 32 bytes of base64");
    }
    if (revisions.has(revision) || keys.has(key.toString("hex"))) {
      throw new Error("INHERIT_HMAC_KEYRING lists a revision or a key twice");
    }
    revisions.add(revision);
    keys.add(key.toString("hex"));
    return { revision, key };
  });
}

function digestUnder(key: Buffer, keyring: HmacKeyring, revision: number, value: string): string {
  // The same two-step shape as `hmacSecret`: a per-purpose sub-key, then the digest.
  const subKey = crypto
    .createHmac("sha256", key)
    .update(`${keyring}-hmac-v${revision}`, "utf8")
    .digest();
  return crypto.createHmac("sha256", subKey).update(value, "utf8").digest("hex");
}

/** `value` keyed under every revision this deployment holds. */
export function keyedDigestSet(
  keyring: HmacKeyring,
  value: string,
  setting: string | undefined = process.env.INHERIT_HMAC_KEYRING,
): DigestSet {
  const set: DigestSet = { "1": hmacSecret(value, LEGACY_CONTEXT[keyring]) };
  for (const { revision, key } of keyringRootKeys(setting)) {
    set[String(revision)] = digestUnder(key, keyring, revision, value);
  }
  return set;
}

/** A normalized contact address under every held revision, for the keyed RPCs. */
export function contactDigestSet(normalizedContact: string): DigestSet {
  return keyedDigestSet("contact", normalizedContact);
}

/**
 * Every digest a stored contact could carry, for read-only comparisons in a
 * page. The RPC that acts still decides with the database's keyring.
 */
export function contactDigestCandidates(normalizedContact: string): string[] {
  return Object.values(contactDigestSet(normalizedContact));
}

/**
 * The revision-1 digest, for derivations that must stay stable across a
 * rotation (idempotency keys) and for account-holder mail references, which
 * are matched by account rather than by address. Never an authority input.
 */
export function legacyContactDigest(normalizedContact: string): string {
  return hmacSecret(normalizedContact, LEGACY_CONTEXT.contact);
}
