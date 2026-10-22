import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";

/**
 * The presentation token of `api.consent-reaffirm`: short-lived, single-use
 * and server-signed. It carries the exact offer the database computed for one
 * prior purpose grant (`consent_reaffirm_offer_v1`): the prior pair and its
 * revision, the purpose, direction, signer, recipient, relationship or pair
 * and its revision, the subject binding and jurisdiction revisions, the
 * current artifact version and body hash, the published statements and the
 * grant function's own context or endpoint receipt. It is bound to the
 * account and auth session it was minted for. The database recomputes the
 * offer and requires it to be identical, and consumes the token's nonce, so
 * a token reaffirms at most once and can never be retargeted.
 */

const CONTEXT = "consent-reaffirm-presentation-v1";
const LIFETIME_MS = 540_000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);

export const REAFFIRM_KINDS = ["own-report", "path-b", "family"] as const;
export const REAFFIRM_FAMILY_PURPOSES = ["ancestry", "reports.monogenic", "reports.polygenic", "family.portrait",
  "family.heritability", "copilot.local", "export.share-link", "raw.export", "raw.browse"] as const;

/** The database's offer, exactly as it serialises it. Unknown keys are refused. */
export const reaffirmOfferSchema = z.object({
  kind: z.enum(REAFFIRM_KINDS),
  grantFunction: z.string().regex(/^grant_[a-z_]+_v1$/),
  priorGrantId: uuid,
  priorRevision: z.number().int().positive().safe(),
  priorArtifactVersion: z.number().int().positive().safe(),
  purpose: z.string().min(1).max(40),
  direction: z.enum(["self", "subject_to_recipient"]),
  pathBDirection: z.enum(["self", "uploader"]).nullable(),
  subjectId: uuid,
  signerPrincipalId: uuid,
  recipientPrincipalId: uuid,
  recipientAccountId: uuid.nullable(),
  relationshipId: uuid.nullable(),
  pairId: uuid.nullable(),
  relationshipOrPairRevision: z.number().int().positive().safe(),
  subjectBindingRevision: z.number().int().positive().safe(),
  jurisdictionRevision: z.number().int().positive().safe(),
  artifactKey: z.string().min(1).max(80),
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  statementKeys: z.array(z.string().min(1).max(64)).min(1).max(16),
  context: z.record(z.string(), z.unknown()).nullable(),
  endpointReceipt: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strict();
export type ReaffirmOffer = z.infer<typeof reaffirmOfferSchema>;

const claimsSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  offer: reaffirmOfferSchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type ReaffirmPresentation = z.infer<typeof claimsSchema>;

/** Mints a presentation for one offer. Pure: it writes nothing. */
export function mintReaffirmPresentation(
  input: { accountId: string; sessionId: string; offer: ReaffirmOffer },
  now = Date.now(),
): { claims: ReaffirmPresentation; token: string } {
  const claims = claimsSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}` };
}

/** The verified, unexpired claims of a token this deployment minted, or null. */
export function readReaffirmPresentation(token: string, now = Date.now()): ReaffirmPresentation | null {
  if (typeof token !== "string" || token.length > 8192 || !Number.isSafeInteger(now)) return null;
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
