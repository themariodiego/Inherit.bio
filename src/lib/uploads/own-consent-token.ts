import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { OWN_UPLOAD_ARTIFACT_KEYS } from "./own-consent";

const CONTEXT = "own-upload-artifact-presentation-v1";
const LIFETIME_MS = 10 * 60 * 1000;
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const revision = z.number().int().positive().safe();
const claimsSchema = z.object({
  accountId: uuid,
  sessionId: uuid,
  subjectId: uuid,
  accountRevision: revision,
  authSessionRevision: revision,
  jurisdictionRevision: revision,
  subjectBindingRevision: revision,
  artifactKey: z.enum(OWN_UPLOAD_ARTIFACT_KEYS),
  artifactVersion: revision,
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  issuedAt: revision,
  expiresAt: revision,
}).strict();
export type OwnConsentPresentation = z.infer<typeof claimsSchema>;

/** Kept in page memory and the same-origin CSRF header only; no URL or storage. */
export function mintOwnConsentPresentation(
  input: Omit<OwnConsentPresentation, "nonce" | "issuedAt" | "expiresAt">,
  now = Date.now(),
): { token: string; claims: OwnConsentPresentation; nonceHash: string } {
  const claims = claimsSchema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: now, expiresAt: now + LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}`,
    nonceHash: crypto.createHash("sha256").update(claims.nonce).digest("hex") };
}

export function readOwnConsentPresentation(token: string, now = Date.now()): OwnConsentPresentation | null {
  if (token.length > 4096 || !Number.isSafeInteger(now)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  const expected = hmacSecret(parts[0], CONTEXT);
  if (!crypto.timingSafeEqual(Buffer.from(parts[1], "hex"), Buffer.from(expected, "hex"))) return null;
  try {
    const payload = Buffer.from(parts[0], "base64url");
    if (payload.toString("base64url") !== parts[0]) return null;
    const parsed = claimsSchema.safeParse(JSON.parse(payload.toString("utf8")));
    if (!parsed.success) return null;
    const claims = parsed.data;
    return claims.issuedAt <= now && claims.expiresAt > now
      && claims.expiresAt - claims.issuedAt === LIFETIME_MS ? claims : null;
  } catch { return null; }
}
