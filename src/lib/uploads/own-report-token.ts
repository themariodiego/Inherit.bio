import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { OWN_REPORT_CHOICES, OWN_REPORT_PURPOSES } from "./own-report-purpose";

const CONTEXT = "own-report-purpose-presentation-v1";
const revision = z.number().int().positive().safe();
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
export const ownReportSnapshot = z.object({
  accountRevision: revision, authSessionRevision: revision, jurisdictionRevision: revision,
  subjectBindingRevision: revision, accountBindingRevision: revision, uploadConsentId: uuid,
  subjectLifecycleRevision: revision, originatingSessionRevision: revision,
  principalId: uuid, principalRevision: revision,
}).strict();
const schema = z.object({
  accountId: uuid, sessionId: uuid, subjectId: uuid, snapshot: ownReportSnapshot,
  purpose: z.enum(OWN_REPORT_PURPOSES), artifactKey: z.string().max(64), artifactVersion: revision,
  artifactBodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), issuedAt: revision, expiresAt: revision,
}).strict().refine(c => c.artifactKey === OWN_REPORT_CHOICES[c.purpose].artifactKey);
export type OwnReportPresentation = z.infer<typeof schema>;

export function mintOwnReportPresentation(input: Omit<OwnReportPresentation, "nonce" | "issuedAt" | "expiresAt">, now = Date.now()) {
  // Stay below the database's ten-minute ceiling despite small clock skew.
  const claims = schema.parse({ ...input, nonce: crypto.randomBytes(24).toString("base64url"), issuedAt: now, expiresAt: now + 540_000 });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { claims, token: `${payload}.${hmacSecret(payload, CONTEXT)}` };
}
export function readOwnReportPresentation(token: string, now = Date.now()): OwnReportPresentation | null {
  if (token.length > 4096 || !Number.isSafeInteger(now)) return null;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !payload || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(signature ?? "")) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(hmacSecret(payload, CONTEXT), "hex"))) return null;
  try {
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.toString("base64url") !== payload) return null;
    const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) return null;
    const c = parsed.data;
    return c.issuedAt <= now && c.expiresAt > now && c.expiresAt - c.issuedAt === 540_000 ? c : null;
  } catch { return null; }
}
