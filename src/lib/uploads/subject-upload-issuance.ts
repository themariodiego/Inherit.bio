import "server-only";

import { createAdminClient } from "../supabase/admin";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { assertStorageUploadSignerAvailable, mintStorageUploadToken, storageUploadAuthorizationSchema } from "./storage-upload-token";
import { directUploadReceipt, uploadCeilingBytes, uploadSessionBody } from "./subject-upload-contract";
import { canonicalUploadsPaused } from "./canonical-upload-pause";
import { readOwnUploadLimits } from "./own-upload-limits";

/** This endpoint accepts a small declaration, never the file or a filename. */
async function readDeclaration(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 4096) return null;
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Canonical ordinary-subject issuance. Cohort transport is a separate resolver,
 * not an excuse to grant that target this direct-to-Storage bearer. */
export async function issueSubjectUpload(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return ownUploadJson({ error: "invalid_request" }, 422);
  }
  const body = uploadSessionBody.safeParse(await readDeclaration(request));
  if (!body.success) return ownUploadJson({ error: "invalid_request" }, 422);
  try {
    const actor = await currentOwnUploadAccount();
    if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
    if (!("subjectId" in body.data)) return ownUploadJson({ error: "unavailable" }, 503);
    if (canonicalUploadsPaused()) return ownUploadJson({ error: "uploads_paused" }, 503);
    // No durable upload row when the deployment cannot mint its bearer.
    assertStorageUploadSignerAvailable();
    const { data, error } = await createAdminClient().rpc("issue_own_storage_upload_v1", {
      p_account_id: actor.accountId, p_session_id: actor.sessionId,
      p_subject_id: body.data.subjectId === "me" ? null : body.data.subjectId,
      p_declared_format: body.data.declaredFormat, p_size_bytes: body.data.sizeBytes, p_sha256: body.data.sha256,
    });
    if (error) {
      if (error.code === "42501") return ownUploadJson({ error: "not_found" }, 404);
      // The issuer raises one class for a malformed declaration and for both
      // ceilings. Naming the wrong one sends someone away to shrink a file
      // that was never the problem, so resolve which limit actually refused.
      if (error.code === "22023") {
        if (error.message?.includes("invalid_request")) return ownUploadJson({ error: "invalid_request" }, 422);
        const limits = await readOwnUploadLimits(actor);
        const overFormatCeiling = !limits
          || body.data.sizeBytes > uploadCeilingBytes(body.data.declaredFormat, limits);
        return ownUploadJson({ error: overFormatCeiling ? "too_large" : "account_full" }, 413);
      }
      if (error.code === "55000") return ownUploadJson({ error: "upload_unavailable" }, 409);
      return ownUploadJson({ error: "unavailable" }, 503);
    }
    const receipt = storageUploadAuthorizationSchema.safeParse(data);
    if (!receipt.success || receipt.data.accountId !== actor.accountId || receipt.data.sessionId !== actor.sessionId
      || receipt.data.maximumBytes !== body.data.sizeBytes) return ownUploadJson({ error: "unavailable" }, 503);
    const now = Date.now();
    const token = mintStorageUploadToken(receipt.data, now);
    return ownUploadJson(directUploadReceipt.parse({
      transport: "direct-storage", uploadId: receipt.data.uploadId, bucket: "genomes", stagingKey: receipt.data.stagingKey,
      uploadToken: token, authorizationHeader: "Bearer {uploadToken}", maximumBytes: receipt.data.maximumBytes,
      expiresAt: new Date(Math.min(Math.floor(Date.parse(receipt.data.expiresAt) / 1000),
        Math.floor(now / 1000) + 1800) * 1000).toISOString(),
    }), 201);
  } catch { return ownUploadJson({ error: "unavailable" }, 503); }
}
