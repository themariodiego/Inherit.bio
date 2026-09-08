import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { ownReportPurposeBody } from "./own-report-purpose";
import { readOwnReportPresentation } from "./own-report-token";

const receiptSchema = z.object({ recordKind: z.literal("purpose_grant"), recordId: z.uuid(),
  artifactKey: z.string(), artifactVersion: z.number().int().positive().safe(),
  purposeKey: z.string(), signedAt: z.iso.datetime({ offset: true }),
}).strict();

/** A token with this authenticated context cannot fall through to a family-sharing write. */
export function isOwnReportConsentPayload(value: unknown): boolean {
  return typeof value === "object" && value !== null && "action" in value && value.action === "grant-purpose"
    && "artifactPresentationToken" in value && typeof value.artifactPresentationToken === "string"
    && readOwnReportPresentation(value.artifactPresentationToken) !== null;
}

export async function ownReportConsent(request: Request, payload: unknown): Promise<Response> {
  const parsed = ownReportPurposeBody.safeParse(payload);
  if (!parsed.success) return ownUploadJson({ error: "invalid_request" }, 422);
  const body = parsed.data;
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-inherit-csrf") !== body.artifactPresentationToken) return ownUploadJson({ error: "forbidden" }, 403);
  const actor = await currentOwnUploadAccount();
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  const c = readOwnReportPresentation(body.artifactPresentationToken);
  if (!c || c.accountId !== actor.accountId || c.sessionId !== actor.sessionId
    || c.subjectId !== body.subjectId || c.purpose !== body.purposeKey || c.artifactVersion !== body.artifactVersion) {
    return ownUploadJson({ error: "not_found" }, 404);
  }
  const { data, error } = await createAdminClient().rpc("grant_own_report_purpose_v1", {
    p_account_id: actor.accountId, p_session_id: actor.sessionId, p_subject_id: c.subjectId,
    p_snapshot: c.snapshot, p_purpose: c.purpose, p_artifact_version: c.artifactVersion,
    p_artifact_body_sha256: c.artifactBodySha256,
    p_nonce_hash: crypto.createHash("sha256").update(c.nonce).digest("hex"), p_expires_at: new Date(c.expiresAt).toISOString(),
  });
  if (error) {
    if (["42501", "23505"].includes(error.code)) return ownUploadJson({ error: "not_found" }, 404);
    if (error.code === "22023") return ownUploadJson({ error: "invalid_request" }, 422);
    if (error.code === "55000") return ownUploadJson({ error: error.message === "consent_artifact_changed" ? "consent_artifact_changed" : "state_conflict" }, 409);
    return ownUploadJson({ error: "unavailable" }, 503);
  }
  const receipt = receiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.artifactKey !== c.artifactKey || receipt.data.artifactVersion !== c.artifactVersion
    || receipt.data.purposeKey !== c.purpose) return ownUploadJson({ error: "unavailable" }, 503);
  return ownUploadJson(receipt.data, 201);
}
