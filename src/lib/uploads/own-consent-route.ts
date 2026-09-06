import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownConsentBody, OWN_UPLOAD_STATEMENTS } from "./own-consent";
import { readOwnConsentPresentation } from "./own-consent-token";

const signatureResponse = z.object({
  recordKind: z.literal("artifact_signature"), recordId: z.uuid(),
  artifactKey: z.string(), artifactVersion: z.number().int().positive().safe(),
  signedAt: z.iso.datetime({ offset: true }),
}).strict();

function response(body: unknown, status: number) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  } });
}

/** Only the own-subject Tier-1 case; never a shortcut to third-party permission. */
export async function ownUploadConsent(request: Request, payload: unknown): Promise<Response> {
  const parsed = ownConsentBody.safeParse(payload);
  if (!parsed.success) return response({ error: "invalid_request" }, 422);
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return response({ error: "forbidden" }, 403);
  }
  const body = parsed.data;
  if (request.headers.get("x-inherit-csrf") !== body.artifactPresentationToken) {
    return response({ error: "forbidden" }, 403);
  }
  const client = await createClient();
  const [{ data: userData }, { data: claimsData }] = await Promise.all([
    client.auth.getUser(), client.auth.getClaims(),
  ]);
  const user = userData.user;
  const auth = claimsData?.claims;
  if (!user || auth?.sub !== user.id || typeof auth.session_id !== "string") {
    return response({ error: "unauthorized" }, 401);
  }
  const presentation = readOwnConsentPresentation(body.artifactPresentationToken);
  if (!presentation || presentation.accountId !== user.id || presentation.sessionId !== auth.session_id
    || presentation.subjectId !== body.subjectId || presentation.artifactVersion !== body.artifactVersion
    || body.statementKeys[0] !== OWN_UPLOAD_STATEMENTS[presentation.artifactKey][0]) {
    return response({ error: "not_found" }, 404);
  }
  const { data, error } = await createAdminClient().rpc("sign_own_upload_artifact_v1", {
    p_account_id: user.id, p_session_id: auth.session_id, p_subject_id: presentation.subjectId,
    p_artifact_key: presentation.artifactKey, p_artifact_version: presentation.artifactVersion,
    p_artifact_body_sha256: presentation.artifactBodySha256, p_statement_keys: body.statementKeys,
    p_account_revision: presentation.accountRevision, p_auth_session_revision: presentation.authSessionRevision,
    p_jurisdiction_revision: presentation.jurisdictionRevision,
    p_subject_binding_revision: presentation.subjectBindingRevision,
    p_nonce_hash: crypto.createHash("sha256").update(presentation.nonce).digest("hex"),
  });
  if (error) {
    if (error.code === "42501" || error.code === "23505") return response({ error: "not_found" }, 404);
    if (error.code === "22023") return response({ error: "invalid_request" }, 422);
    if (error.code === "55000") {
      const known = ["adult_account_required", "consent_artifact_changed", "insurance_acknowledgement_required"];
      return response({ error: known.includes(error.message) ? error.message : "state_conflict" }, 409);
    }
    return response({ error: "unavailable" }, 503);
  }
  // Do not relay an open database object or a fabricated signing time.
  const receipt = signatureResponse.safeParse(data);
  if (!receipt.success || receipt.data.artifactKey !== presentation.artifactKey
    || receipt.data.artifactVersion !== presentation.artifactVersion) {
    return response({ error: "unavailable" }, 503);
  }
  return response(receipt.data, 201);
}
