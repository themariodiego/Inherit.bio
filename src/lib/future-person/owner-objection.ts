import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { hmacSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintPublicFormToken, readPublicFormToken } from "@/lib/embryos/operation-token";
import { claimantSessionHash } from "./rights";
import { claimDataKey, newWrappedDocumentKey, sealDocumentBytes } from "./document-envelope";

const normalizedStatement = z.string().max(16000).transform(value => value.normalize("NFC").trim())
  .refine(value => [...value].length >= 20 && [...value].length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value));
export const ownerObjectionBody = z.object({ statement: normalizedStatement, nonce: z.string().min(1).max(2048) }).strict();
export const ownerObjectionScope = z.object({ claimId: z.uuid(), noticeId: z.uuid(), noticeRevision: z.number().int().positive() }).strict();
export const ownerObjectionView = z.object({
  safeNoticeSummary: z.literal("A claim to a record you hold is pending."),
  noticeDeadline: z.iso.datetime({ offset: true }),
  objectionArtifactBody: z.literal("Your objection pauses only this claim while a named person reviews it. Your record stays as it is."),
  allowedActionIds: z.tuple([z.literal("object")]),
}).strict();
export function ownerObjectionCsrf(hash: string): string { return hmacSecret(hash, "future-person-owner-objection-csrf-v1"); }
export async function loadOwnerObjection(request: Request) {
  const hash = claimantSessionHash(request); if (!hash) return null;
  const { data, error } = await createAdminClient().rpc("future_person_objection_view_v1", { p_session_hash: hash });
  const parsed = ownerObjectionView.safeParse(data); if (error || !parsed.success) return null;
  // The view and its proof are stateless. Only the authorized POST consumes
  // this operation-specific nonce; no case, candidate or nonce is stored here.
  return { view: parsed.data, csrf: ownerObjectionCsrf(hash),
    nonce: mintPublicFormToken("future-person-claim-objection", Date.now(), hash) };
}
export function ownerObjectionMutation(request: Request, token: string) {
  const hash = claimantSessionHash(request); const url = new URL(request.url);
  const csrf = request.headers.get("x-inherit-csrf");
  if (!hash || url.search || request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin"
    || !csrf || !/^[0-9a-f]{64}$/u.test(csrf) || token.length > 2048
    || !crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(ownerObjectionCsrf(hash)))) return null;
  const proof = readPublicFormToken(token, "future-person-claim-objection", Date.now(), hash);
  return proof ? { sessionHash: hash, nonce: proof.nonce } : null;
}
export function sealOwnerObjection(statement: string, scope: z.infer<typeof ownerObjectionScope>) {
  const parsed = ownerObjectionScope.parse(scope); const value = normalizedStatement.parse(statement);
  const wrapped = newWrappedDocumentKey(); const key = claimDataKey(wrapped.toString("hex"));
  const bytes = Buffer.from(value, "utf8");
  try { return { ciphertext: `\\x${sealDocumentBytes(key, `future-person-owner-objection-v1|${JSON.stringify(parsed)}`, bytes).toString("hex")}`,
    wrappedKey: `\\x${wrapped.toString("hex")}` }; }
  finally { key.fill(0); wrapped.fill(0); bytes.fill(0); }
}
