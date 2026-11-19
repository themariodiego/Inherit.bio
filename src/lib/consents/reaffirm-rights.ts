import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { adultSubjectRequestAllowed } from "@/lib/embryos/adult-subject-review";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { readRightsSessionHash, RIGHTS_COOKIE_NAME } from "@/lib/embryos/rights-session";

/**
 * The form and presentation of a consent-reaffirm rights session
 * (`api.consent-reaffirm-rights`). The session is bound to one prior
 * uploader-direction grant and its revision; its issuer is not built, so no
 * page serves either token today. The rights page would serve one sealed
 * form token bound to sha256 of the session cookie, used as the body nonce,
 * and one presentation naming exactly the prior pair, its revision, the
 * non-account principal, the uploader, the uploader relationship and its
 * revision, the subject binding revision, the purpose and the current
 * consent.share-with-adult version and body hash. The database rechecks
 * every value and consumes both nonces.
 */

const FORM = "consent-reaffirm-rights" as const;
const CONTEXT = "consent-reaffirm-rights-presentation-v1";
const LIFETIME_MS = 540_000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
export const REAFFIRM_RIGHTS_ARTIFACT_KEY = "consent.share-with-adult";
export const REAFFIRM_RIGHTS_STATEMENT_KEYS = ["one-purpose", "one-named-adult", "own-account", "pause-or-stop-any-time"] as const;
export const REAFFIRM_RIGHTS_PURPOSES = ["reports.monogenic", "reports.polygenic", "ancestry"] as const;

/** The form token a rights page serves for its own session. Pure. */
export function mintConsentReaffirmRightsForm(sessionHash: string, now = Date.now()): string {
  if (!/^[0-9a-f]{64}$/.test(sessionHash)) throw new Error("rights_session_hash_invalid");
  return mintPublicFormToken(FORM, now, sessionHash);
}

/** The session hash and one-time nonce of a form served for this session, or null. */
export function readConsentReaffirmRightsRequest(request: Request, nonce: string, now = Date.now()) {
  if (!adultSubjectRequestAllowed(request)) return null;
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().split("=")[0] === RIGHTS_COOKIE_NAME);
  if (cookies.length !== 1) return null;
  const sessionHash = readRightsSessionHash(request);
  if (!sessionHash) return null;
  const claims = readPublicFormToken(nonce, FORM, now, sessionHash);
  return claims ? { sessionHash, nonce: claims.nonce } : null;
}

const claimsSchema = z.object({
  sessionHash: z.string().regex(/^[0-9a-f]{64}$/),
  priorGrantId: uuid,
  priorRevision: z.number().int().positive().safe(),
  principalId: uuid,
  uploaderPrincipalId: uuid,
  uploaderAccountId: uuid,
  relationshipId: uuid,
  relationshipRevision: z.number().int().positive().safe(),
  subjectBindingRevision: z.number().int().positive().safe(),
  purpose: z.enum(REAFFIRM_RIGHTS_PURPOSES),
  artifactKey: z.literal(REAFFIRM_RIGHTS_ARTIFACT_KEY),
  artifactVersion: z.number().int().positive().safe(),
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: z.number().int().positive().safe(),
  expiresAt: z.number().int().positive().safe(),
}).strict();
export type ReaffirmRightsPresentation = z.infer<typeof claimsSchema>;

/** Mints a presentation for one prior grant of one session. Pure: it writes nothing. */
export function mintReaffirmRightsPresentation(
  input: Omit<ReaffirmRightsPresentation, "nonce" | "issuedAt" | "expiresAt">,
  now = Date.now(),
): { claims: ReaffirmRightsPresentation; token: string } {
  const claims = claimsSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}` };
}

/** The verified, unexpired claims of a token this deployment minted, or null. */
export function readReaffirmRightsPresentation(token: string, now = Date.now()): ReaffirmRightsPresentation | null {
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

/** The twelve values the database rechecks, and nothing the session itself decides. */
export function reaffirmRightsPresentationForDatabase(c: ReaffirmRightsPresentation) {
  return {
    priorGrantId: c.priorGrantId, priorRevision: c.priorRevision, principalId: c.principalId,
    uploaderPrincipalId: c.uploaderPrincipalId, uploaderAccountId: c.uploaderAccountId, relationshipId: c.relationshipId,
    relationshipRevision: c.relationshipRevision, subjectBindingRevision: c.subjectBindingRevision, purpose: c.purpose,
    artifactVersion: c.artifactVersion, artifactBodySha256: c.artifactBodySha256, nonce: c.nonce,
  };
}
