import { z } from "zod";
import { closedResponse } from "@/lib/embryos/guards";
import { notFound, unavailable } from "@/lib/embryos/api";
import { readBoundedJson } from "@/lib/future-person/bounded-body";
import { claimMutationCsrfMatches, newClaimSessionRotation, sha256Hex } from "@/lib/future-person/claim-session";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { claimSessionHash, readClaimCompleteNonce } from "@/lib/future-person/evidence-session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/future-person/claim/session/complete`
 * (register api.future-person-claim-complete). The claim-session cookie
 * names the claim; the closed body names its mode, its two clean documents,
 * the affirmation and the one-time nonce the claim page rendered.
 *
 * The database checks the mode is the stored one, that each document is a
 * clean one of its kind on this claim, resolves the review case, enqueues it
 * for a named human with the 30-day decision deadline, and ends the claim
 * session. Every accepted completion answers the same 202
 * future-person-claim-acceptance-v1; nothing about a match, a candidate or
 * a review reaches the claimant. Anything unknown, missing, invalid or
 * crossing sessions is the opaque 404.
 */

const RECEIVED_KEYS = ["status"] as const;

const body = z.object({
  mode: z.enum(["record-key", "claimant-recovery-key", "keyless"]),
  photoIdentityDocumentId: z.uuid(),
  birthRecordDocumentId: z.uuid(),
  affirmed: z.literal(true),
  nonce: z.string().min(1).max(2048),
}).strict().refine((value) => value.photoIdentityDocumentId !== value.birthRecordDocumentId);

function withoutReferrer(response: Response): Response {
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  return withoutReferrer(await complete(request));
}

async function complete(request: Request): Promise<Response> {
  if (!futurePersonClaimsOpen()) return notFound();
  const url = new URL(request.url);
  if (
    url.search !== "" ||
    request.headers.get("origin") !== url.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() !== "application/json"
  ) {
    return notFound();
  }
  const claimHash = claimSessionHash(request);
  if (!claimHash) return notFound();
  const parsed = body.safeParse(await readBoundedJson(request, 4096));
  if (!parsed.success) return notFound();
  const nonce = readClaimCompleteNonce(parsed.data.nonce, claimHash);
  if (!nonce || !claimMutationCsrfMatches(request.headers.get("x-inherit-csrf"), claimHash, "complete", parsed.data.nonce)) return notFound();

  const successor = newClaimSessionRotation();
  const { data, error } = await createAdminClient().rpc("complete_future_person_claim_rotated_v1", {
    p_session_hash: claimHash,
    p_successor_session_hash: successor.sessionHash,
    p_nonce_hash: sha256Hex(nonce),
    p_mode: parsed.data.mode,
    p_photo_document_id: parsed.data.photoIdentityDocumentId,
    p_birth_record_document_id: parsed.data.birthRecordDocumentId,
  });
  if (error) return ["42501", "23505", "22023"].includes(error.code ?? "") ? notFound() : unavailable();
  const accepted = data as { status?: unknown; expiresAt?: unknown } | null;
  if (accepted?.status !== "received" || typeof accepted.expiresAt !== "string") return unavailable();
  const expiry = new Date(accepted.expiresAt);
  if (Number.isNaN(expiry.getTime())) return unavailable();
  const response = await closedResponse("api.future-person-claim-complete", RECEIVED_KEYS, { status: "received" }, 202);
  if (response.status === 202) response.headers.append("Set-Cookie", successor.setCookie(expiry));
  return response;
}
