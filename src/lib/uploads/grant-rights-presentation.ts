import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";

/**
 * The presentation token of `api.consent-grant-rights`
 * (policyContracts.directional-purpose-grant-v1): short-lived, single-use and
 * server-signed. The rights page of an adult-subject-control session mints
 * one per purpose it offers, bound to sha256 of that session's cookie, the
 * exact non-account signer and data-subject principal, the immutable Path B
 * uploader principal and account, the current uploader relationship and its
 * revision (or none yet), the subject binding revision, the one purpose and
 * the exact consent.share-with-adult version and body hash. The route
 * accepts only a token it can verify for the same session; the database
 * rechecks every bound value against current state and consumes the token's
 * nonce, so a token grants at most once and can never be retargeted.
 */

const CONTEXT = "consent-grant-rights-presentation-v1";
const LIFETIME_MS = 540_000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
export const GRANT_RIGHTS_ARTIFACT_KEY = "consent.share-with-adult";
export const GRANT_RIGHTS_STATEMENT_KEYS = ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"] as const;
export const GRANT_RIGHTS_PURPOSES = ["reports.monogenic", "reports.polygenic", "ancestry", "copilot.local"] as const;

const claimsSchema = z.object({
  sessionHash: z.string().regex(/^[0-9a-f]{64}$/),
  principalId: uuid,
  uploaderPrincipalId: uuid,
  uploaderAccountId: uuid,
  subjectBindingRevision: z.number().int().positive().safe(),
  relationshipId: uuid.nullable(),
  relationshipRevision: z.number().int().positive().safe().nullable(),
  purpose: z.enum(GRANT_RIGHTS_PURPOSES),
  artifactKey: z.literal(GRANT_RIGHTS_ARTIFACT_KEY),
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict().refine(c => (c.relationshipId === null) === (c.relationshipRevision === null));
export type GrantRightsPresentation = z.infer<typeof claimsSchema>;

/** Mints a presentation for one purpose of one session. Pure: it writes nothing. */
export function mintGrantRightsPresentation(
  input: Omit<GrantRightsPresentation, "nonce" | "issuedAt" | "expiresAt">,
  now = Date.now(),
): { claims: GrantRightsPresentation; token: string } {
  const claims = claimsSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}` };
}

/** The verified, unexpired claims of a token this deployment minted, or null. */
export function readGrantRightsPresentation(token: string, now = Date.now()): GrantRightsPresentation | null {
  if (typeof token !== "string" || token.length > 4096 || !Number.isSafeInteger(now)) return null;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature ?? "")) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature!, "hex"), Buffer.from(hmacSecret(payload, CONTEXT), "hex"))) return null;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.toString("base64url") !== payload) return null;
    const parsed = claimsSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) return null;
    const c = parsed.data;
    return c.issuedAt <= now && c.expiresAt > now && c.expiresAt - c.issuedAt === LIFETIME_MS ? c : null;
  } catch { return null; }
}

/** The ten values the database rechecks, and nothing the session itself decides. */
export function presentationForDatabase(c: GrantRightsPresentation) {
  return {
    principalId: c.principalId, uploaderPrincipalId: c.uploaderPrincipalId, uploaderAccountId: c.uploaderAccountId,
    subjectBindingRevision: c.subjectBindingRevision, relationshipId: c.relationshipId,
    relationshipRevision: c.relationshipRevision, purpose: c.purpose, artifactVersion: c.artifactVersion,
    artifactBodySha256: c.artifactBodySha256, nonce: c.nonce,
  };
}
