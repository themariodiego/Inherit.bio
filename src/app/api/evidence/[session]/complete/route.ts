import { z } from "zod";
import { closedResponse } from "@/lib/embryos/guards";
import { invalidRequest, notFound, sensitiveJson, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { supabaseClaimObjectStore } from "@/lib/future-person/claim-objects";
import { sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { composeClaimDocument, compositionPlan } from "@/lib/future-person/document-compose";
import { completeNonceMatches, readEvidenceRequest } from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/evidence/[session]/complete` (register api.evidence-complete),
 * for the claim document sessions this deployment issues.
 *
 * The body is closed: the chunk count and the one-time completion nonce the
 * session was opened with. The database checks the manifest is exactly the
 * contiguous written chunks and spends the nonce; this route then composes
 * one sealed object from them (exact size, exact SHA-256, the type sniffed
 * from the bytes) and the database records it QUARANTINED.
 *
 * evidence-complete-v1 promises `review_pending` only after the malware scan
 * has cleared the bytes. The scan runs in the scan worker, so until it has
 * answered the route says `202 {"status":"scanning"}`, and the same request
 * (same nonce) may be sent again to ask. That interim answer is recorded in
 * docs/register-contract-divergence.json. A refused document gets one closed
 * reason and nothing else.
 */

const COMPLETE_KEYS = ["documentId", "documentKind", "status"] as const;
const REASONS = ["integrity", "type", "storage", "expired", "infected", "unscannable", "oversize"] as const;

const body = z.object({
  chunkCount: z.number().int().min(1).max(5),
  nonce: z.string().min(1).max(128),
}).strict();

const status = z.discriminatedUnion("status", [
  z.object({ status: z.literal("composing") }).strict(),
  z.object({ status: z.literal("scanning"), documentId: z.uuid(), documentKind: z.string() }).strict(),
  z.object({
    status: z.literal("review_pending"),
    documentId: z.uuid(),
    documentKind: z.enum(["future-photo-identity", "future-birth-record"]),
  }).strict(),
  z.object({ status: z.literal("refused"), reason: z.enum(REASONS) }).strict(),
]);

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function answer(value: z.infer<typeof status>): Promise<Response> {
  switch (value.status) {
    case "review_pending":
      return closedResponse("api.evidence-complete", COMPLETE_KEYS, {
        documentId: value.documentId, documentKind: value.documentKind, status: "review_pending",
      }, 201);
    case "refused":
      return sensitiveJson({ error: "document_refused", reason: value.reason }, 422);
    default:
      return sensitiveJson({ status: "scanning" }, 202, { "Retry-After": "5" });
  }
}

export async function POST(request: Request, context: { params: Promise<{ session: string }> }) {
  const { session } = await context.params;
  return withoutReferrer(await complete(request, session));
}

async function complete(request: Request, session: string): Promise<Response> {
  if (!futurePersonClaimsOpen()) return notFound();
  const cookieHash = readEvidenceRequest(request, session, "application/json");
  if (!cookieHash) return notFound();
  const json = await readBoundedJson(request, 1024);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) =>
      issue.path[0] === "chunkCount" || issue.path[0] === "nonce" ? String(issue.path[0]) : "body"));
    return invalidRequest([...fields].sort());
  }
  if (!completeNonceMatches(parsed.data.nonce, session, cookieHash)) return notFound();
  const nonceHash = sha256Hex(parsed.data.nonce);

  const admin = createAdminClient();
  const begun = await admin.rpc("begin_claim_document_completion_v1", {
    p_session_id: session, p_cookie_hash: cookieHash, p_complete_nonce_hash: nonceHash,
    p_chunk_count: parsed.data.chunkCount,
  });
  if (begun.error) return ["42501", "23505"].includes(begun.error.code ?? "") ? notFound() : unavailable();
  const plan = compositionPlan.safeParse(begun.data);
  if (!plan.success) {
    const known = status.safeParse(begun.data);
    return known.success ? answer(known.data) : unavailable();
  }

  const store = supabaseClaimObjectStore(admin);
  const outcome = await composeClaimDocument(plan.data, store);
  const finished = await admin.rpc("finish_claim_document_completion_v1", {
    p_session_id: session, p_cookie_hash: cookieHash, p_complete_nonce_hash: nonceHash,
    p_outcome: outcome, p_object_key: outcome === "composed" ? plan.data.objectKey : null,
  });
  if (finished.error) return unavailable();
  if (outcome === "composed") {
    // The fragments are no longer needed. A failure here is retried by the
    // retention job, which finds every fragment still listed.
    const fragmentKeys = plan.data.fragments.map((fragment) => fragment.objectKey);
    try {
      await store.remove(fragmentKeys);
      await admin.rpc("confirm_claim_document_objects_deleted_v1", {
        p_object_keys: fragmentKeys, p_route_id: "api.evidence-complete",
      });
    } catch {
      // Left for jobs.retention.
    }
  }
  const known = status.safeParse(finished.data);
  return known.success ? answer(known.data) : unavailable();
}
