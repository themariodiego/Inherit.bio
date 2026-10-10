import { z } from "zod";
import { closedResponse } from "@/lib/embryos/guards";
import { notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { appealDocumentKind, readPublicAppealMutation } from "@/lib/future-person/public-appeal-session";
import { newWrappedDocumentKey } from "@/lib/future-person/document-envelope";
import { createAppealIntakeRuntime } from "@/lib/future-person/appeal-intake-runtime";
import { evidenceCookie, evidenceCsrf, evidenceCompleteNonce, newEvidenceSecret, EVIDENCE_CSRF_HEADER, EVIDENCE_COMPLETE_NONCE_HEADER } from "@/lib/future-person/evidence-session";
const body = z.object({ documentKind: appealDocumentKind, mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
 sizeBytes: z.number().int().min(1).max(20_000_000), sha256: z.string().regex(/^[0-9a-f]{64}$/u) }).strict();
const opened = z.object({ status: z.literal("open"), session: z.uuid(), documentKind: appealDocumentKind, expiresAt: z.iso.datetime({ offset: true }) }).strict();
const limited = z.object({ status: z.literal("capacity_limited") }).strict();
/** The caller never supplies a case, principal, bucket, object path or reviewer. */
export async function POST(request: Request) {
 const owner = createAppealIntakeRuntime(request.signal); let response: Response | null = null; let refused = false;
 try {
  const proof = readPublicAppealMutation(request, "document", request.headers.get("x-inherit-operation-nonce"));
  if (!proof) return notFound();
  const parsed = body.safeParse(await owner.wait(owner.read(() => readBoundedJson(request, 4096)))); if (!parsed.success) return notFound();
  const evidence = newEvidenceSecret(); const wrapped = owner.own(newWrappedDocumentKey());
  const { data, error } = await owner.wait(owner.rpc("public-commit", () => createAdminClient().rpc("open_public_appeal_document_v1", { p_session_hash: proof.sessionHash,
   p_nonce: proof.nonce, p_document_kind: parsed.data.documentKind, p_media_type: parsed.data.mediaType, p_size_bytes: parsed.data.sizeBytes,
   p_sha256: parsed.data.sha256, p_cookie_hash: evidence.hash, p_wrapped_document_key: `\\x${wrapped.toString("hex")}` }).retry(false).abortSignal(owner.signal)));
  if (error) refused = ["42501", "23505", "22023"].includes(error.code ?? "");
  else if (limited.safeParse(data).success) response = sensitiveJson({ error: "try_again_later" }, 429, { "Retry-After": "900" });
  else {
   const session = opened.safeParse(data);
   if (session.success && session.data.documentKind === parsed.data.documentKind) {
    const expiry = new Date(session.data.expiresAt);
    if (expiry.getTime() <= Date.now()) refused = true;
    else {
     const id = session.data.session;
     response = await closedResponse("api.appeal-document-session", ["session", "documentKind", "chunkBytes", "maximumChunks", "maximumDocumentBytes", "chunkRoute", "completeRoute", "expiresAt"],
   { session: id, documentKind: session.data.documentKind, chunkBytes: 4_000_000, maximumChunks: 5, maximumDocumentBytes: 20_000_000,
    chunkRoute: `/api/evidence/${id}/chunks/{sequence}`, completeRoute: `/api/evidence/${id}/complete`, expiresAt: expiry.toISOString() }, 201);
     if (response.status === 201) {
      response.headers.set("Set-Cookie", evidenceCookie(evidence.secret, expiry)); response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set(EVIDENCE_CSRF_HEADER, evidenceCsrf(id, evidence.hash)); response.headers.set(EVIDENCE_COMPLETE_NONCE_HEADER, evidenceCompleteNonce(id, evidence.hash));
     }
    }
   }
  }
 } catch { /* A lost native response never authorizes adopting its session. */ }
 finally { await owner.finish(); }
 const settled = owner.disposition();
 if (settled.cleanupHeld || settled.pendingActualTasks !== 0 || settled.ownedMutableBuffers !== 0) return unavailable();
 return response ?? (refused ? notFound() : unavailable());
}
