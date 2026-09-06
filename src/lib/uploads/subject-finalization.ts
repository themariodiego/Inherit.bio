import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { SUBJECT_UPLOAD_FORMATS } from "./subject-upload-contract";
import { SubjectStructureError, validateSubjectStructure } from "./subject-structure";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const positive = z.number().int().positive().safe();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema = z.object({ status: z.literal("authorized"), uploadId: uuid, claim: uuid,
  bucket: z.literal("genomes"), stagingKey: uuid, finalKey: uuid, expectedSize: positive,
  expectedSha256: digest.nullable(), declaredFormat: z.enum(SUBJECT_UPLOAD_FORMATS), maximumDecodedBytes: positive,
}).strict().refine(value => value.stagingKey !== value.finalKey);
type Manifest = z.infer<typeof manifestSchema>;
const completed = z.object({ fileId: uuid, status: z.literal("finalized_ready_for_processing"),
  analysisState: z.literal("ready_for_processing"),
  next: z.object({ routeId: z.literal("api.file-process"), operation: z.literal("process") }).strict(),
}).strict();
const alreadyComplete = z.object({ status: z.literal("complete"), fileId: uuid }).strict();
const cleanupSchema = z.object({ bucket: z.literal("genomes"), stagingKey: uuid, finalKey: uuid }).strict();
class FinalizationUnavailable extends Error { constructor() { super("upload_unavailable"); } }
function fail(): never { throw new FinalizationUnavailable(); }

/** Bodyless mutation: the browser never chooses a bucket, path, format or tier. */
export async function finalizeSubjectUpload(request: Request, uploadId: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  if (request.body !== null || new URL(request.url).search || !uuid.safeParse(uploadId).success) {
    return ownUploadJson({ error: "invalid_request" }, 422);
  }
  let actor: Awaited<ReturnType<typeof currentOwnUploadAccount>>;
  let admin: ReturnType<typeof createAdminClient>;
  try { actor = await currentOwnUploadAccount(); admin = createAdminClient(); }
  catch { return ownUploadJson({ error: "unavailable" }, 503); }
  if (!actor) return ownUploadJson({ error: "unauthorized" }, 401);
  const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId, p_upload_id: uploadId };
  let manifest: Manifest | undefined;
  try {
    const begin = await admin.rpc("begin_own_upload_finalization_v1", args);
    if (begin.error) return ownUploadJson(begin.error.code === "42501"
      ? { error: "not_found" } : { error: "unavailable" }, begin.error.code === "42501" ? 404 : 503);
    const prior = alreadyComplete.safeParse(begin.data);
    if (prior.success) return ownUploadJson(completed.parse({ fileId: prior.data.fileId,
      status: "finalized_ready_for_processing", analysisState: "ready_for_processing",
      next: { routeId: "api.file-process", operation: "process" } }));
    const parsed = manifestSchema.safeParse(begin.data);
    if (!parsed.success || parsed.data.uploadId !== uploadId) fail();
    manifest = parsed.data;
    const lease = manifest;
    const authorization = { ...args, p_claim: lease.claim };
    const storage = admin.storage.from("genomes");
    async function recheck() {
      const result = await admin.rpc("authorize_own_upload_finalization_v1", authorization);
      const current = manifestSchema.safeParse(result.data);
      if (result.error || !current.success || JSON.stringify(current.data) !== JSON.stringify(lease)) fail();
    }
    async function* ranges(key: string) {
      for (let start = 0; start < lease.expectedSize; start += INGEST_CHUNK_MAXIMUM_BYTES) {
        await recheck();
        const end = Math.min(lease.expectedSize, start + INGEST_CHUNK_MAXIMUM_BYTES) - 1;
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/genomes/${key}`, {
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `bytes=${start}-${end}` },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
        });
        if (response.status !== 206 || !response.body
          || response.headers.get("content-range") !== `bytes ${start}-${end}/${lease.expectedSize}`) {
          await response.body?.cancel(); fail();
        }
        let received = 0;
        for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += bytes.length;
          if (received > end - start + 1) fail();
          yield bytes;
        }
        if (received !== end - start + 1) throw new SubjectStructureError("upload_integrity_mismatch");
      }
    }
    const evidence = await validateSubjectStructure(ranges(lease.stagingKey), {
      declaredFormat: lease.declaredFormat, expectedSize: lease.expectedSize,
      expectedSha256: lease.expectedSha256, maximumDecodedBytes: lease.maximumDecodedBytes,
    });
    await recheck();
    const copied = await storage.copy(lease.stagingKey, lease.finalKey);
    if (copied.error) fail();
    // Recompute the complete copy hash; metadata and a copy ACK are insufficient.
    const copyHash = createHash("sha256");
    for await (const bytes of ranges(lease.finalKey)) copyHash.update(bytes);
    if (copyHash.digest("hex") !== evidence.rawSha256) throw new SubjectStructureError("upload_integrity_mismatch");
    await recheck();
    const removed = await storage.remove([lease.stagingKey]);
    if (removed.error) fail();
    await recheck();
    const object = await storage.info(lease.finalKey);
    if (object.error || !uuid.safeParse(object.data?.id).success) fail();
    const result = await admin.rpc("complete_own_upload_finalization_v1", { ...authorization,
      p_storage_object_id: object.data!.id, p_raw_sha256: evidence.rawSha256, p_decoded_sha256: evidence.decodedSha256 });
    const receipt = completed.safeParse(result.data);
    if (result.error || !receipt.success) fail();
    return ownUploadJson(receipt.data);
  } catch (error) {
    if (manifest) {
      try {
        const cleanup = await admin.rpc("abort_own_upload_finalization_v1", { ...args, p_claim: manifest.claim });
        const target = cleanupSchema.safeParse(cleanup.data);
        if (cleanup.error || !target.success || target.data.stagingKey !== manifest.stagingKey || target.data.finalKey !== manifest.finalKey) fail();
        const removed = await admin.storage.from("genomes").remove([target.data.stagingKey, target.data.finalKey]);
        if (removed.error) fail();
        const ack = await admin.rpc("ack_own_upload_finalization_cleanup_v1", { ...args, p_claim: manifest.claim });
        if (ack.error || ack.data !== true) fail();
      } catch { return ownUploadJson({ error: "unavailable" }, 503); }
    }
    if (error instanceof SubjectStructureError) {
      const status = error.code === "pdf_not_data" || error.code === "unrecognised_format" ? 415 : error.code === "too_large" ? 413 : 422;
      return ownUploadJson(error.code === "subject_source_not_single_sample"
        ? { error: error.code, messageCopyId: "upload.subject.single-sample-required" } : { error: error.code }, status);
    }
    return ownUploadJson({ error: "unavailable" }, 503);
  }
}
