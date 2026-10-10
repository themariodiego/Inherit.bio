import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { RIGHTS_COOKIE_NAME, rightsSessionHash } from "@/lib/embryos/rights-session";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { readSecretCookie } from "./evidence-session";
import { createAppealIntakeRuntime } from "./appeal-intake-runtime";
import { testAppealIntakeOpen } from "./appeals-open";

export const appealDocumentKind = z.enum(["appeal-photo-identity", "appeal-subject-source-control", "appeal-genetic-parent-authority",
  "appeal-decision-notice", "appeal-contradiction-counterevidence"]);
export const publicAppealView = z.object({
  caseKind: z.enum(["subject-objection", "genetic-parent-objection", "access-or-review-appeal"]),
  deadline: z.iso.datetime({ offset: true }),
  documentKinds: z.array(appealDocumentKind).min(2).max(3),
  evidenceState: z.literal("collecting"), completionAvailable: z.boolean(), informationRequested: z.boolean().optional(),
  documents: z.array(z.object({ documentId: z.uuid(), documentKind: appealDocumentKind }).strict()).max(6),
}).strict();
export type PublicAppealView = z.infer<typeof publicAppealView>;
export function publicAppealSessionHash(request: Request): string | null {
  const secret = readSecretCookie(request, RIGHTS_COOKIE_NAME);
  return secret ? rightsSessionHash(secret) : null;
}
export function publicAppealCsrf(hash: string, operation: "document" | "complete"): string {
  return hmacSecret(hash, `public-appeal-${operation}-csrf-v1`);
}
/** A read does not create a nonce or extend any native clock. */
export async function loadPublicAppealSession(request: Request) {
  if (!testAppealIntakeOpen()) return null;
  const hash = publicAppealSessionHash(request); if (!hash) return null;
  const owner = createAppealIntakeRuntime(request.signal); let view: PublicAppealView | null = null;
  try {
    const { data, error } = await owner.wait(owner.read(() => createAdminClient().rpc("new_public_appeal_evidence_view_v1", { p_session_hash: hash }).retry(false).abortSignal(owner.signal)));
    const parsed = publicAppealView.safeParse(data); if (!error && parsed.success) view = parsed.data;
  } catch { /* No native current view means no purpose-specific form. */ }
  finally { await owner.finish(); }
  const settled = owner.disposition();
  if (!view || settled.cleanupHeld || settled.pendingActualTasks !== 0) return null;
  const now = Date.now();
  return { view, documentCsrf: publicAppealCsrf(hash, "document"), completeCsrf: publicAppealCsrf(hash, "complete"),
    documentNonce: mintPublicFormToken("appeal-document", now, hash), completeNonce: mintPublicFormToken("appeal-complete", now, hash) };
}
/** The document endpoint's closed JSON has no nonce field: its operation token
 * travels in X-Inherit-Operation-Nonce, separately from the CSRF header. */
export function readPublicAppealMutation(request: Request, operation: "document" | "complete", token: unknown) {
  if (!testAppealIntakeOpen() || typeof token !== "string" || token.length > 2048) return null;
  const url = new URL(request.url); const hash = publicAppealSessionHash(request); const csrf = request.headers.get("x-inherit-csrf");
  if (!hash || url.search || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("content-encoding") !== null || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || !csrf || !/^[0-9a-f]{64}$/u.test(csrf) || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(publicAppealCsrf(hash, operation)))) return null;
  const proof = readPublicFormToken(token, operation === "document" ? "appeal-document" : "appeal-complete", Date.now(), hash);
  return proof ? { sessionHash: hash, nonce: proof.nonce } : null;
}
