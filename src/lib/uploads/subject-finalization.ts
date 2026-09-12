import "server-only";

import { createSHA256 } from "hash-wasm";
import { z } from "zod";
import { hasEmptyRequestBody } from "../empty-request-body";
import { createAdminClient } from "../supabase/admin";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { currentOwnUploadAccount, ownUploadJson } from "./own-upload-context";
import { SUBJECT_UPLOAD_FORMATS, subjectFinalizationReceipt as completed } from "./subject-upload-contract";
import { SubjectStructureError, validateSubjectStructure } from "./subject-structure";
import { advanceFinalization, finalizationCheckpointReceiptSchema, finalizationPhaseRank,
  type FinalizationCheckpoint } from "./finalization-progress";

/** Long enough that a working request keeps its lease, short enough that an
 * ordinary retry after a kill can resume rather than wait out the session. */
const FINALIZATION_LEASE_SECONDS = 60;

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const positive = z.number().int().positive().safe();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema = z.object({ status: z.literal("authorized"), uploadId: uuid, claim: uuid,
  bucket: z.literal("genomes"), stagingKey: uuid, finalKey: uuid, expectedSize: positive,
  expectedSha256: digest.nullable(), declaredFormat: z.enum(SUBJECT_UPLOAD_FORMATS), maximumDecodedBytes: positive,
}).strict().refine(value => value.stagingKey !== value.finalKey);
type Manifest = z.infer<typeof manifestSchema>;
const alreadyComplete = z.object({ status: z.literal("complete"), fileId: uuid }).strict();
const cleanupSchema = z.object({ bucket: z.literal("genomes"), stagingKey: uuid, finalKey: uuid }).strict();
class FinalizationUnavailable extends Error { constructor() { super("upload_unavailable"); } }
function fail(): never { throw new FinalizationUnavailable(); }

/** Bodyless mutation: the browser never chooses a bucket, path, format or tier. */
export async function finalizeSubjectUpload(request: Request, uploadId: string) {
  if (request.headers.get("origin") !== new URL(request.url).origin
    || request.headers.get("sec-fetch-site") !== "same-origin") return ownUploadJson({ error: "forbidden" }, 403);
  if (new URL(request.url).search || !uuid.safeParse(uploadId).success || !(await hasEmptyRequestBody(request))) {
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
    /** One authorized range, whole, in memory. Nothing here is yielded. */
    async function fetchRange(key: string, start: number, end: number): Promise<Uint8Array[]> {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/genomes/${key}`, {
        headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `bytes=${start}-${end}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (response.status !== 206 || !response.body
        || response.headers.get("content-range") !== `bytes ${start}-${end}/${lease.expectedSize}`) {
        await response.body?.cancel(); fail();
      }
      const parts: Uint8Array[] = [];
      let received = 0;
      for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += bytes.length;
        if (received > end - start + 1) fail();
        parts.push(bytes);
      }
      if (received !== end - start + 1) throw new SubjectStructureError("upload_integrity_mismatch");
      return parts;
    }

    /**
     * The ranges of one object, read ahead, with authority rechecked
     * IMMEDIATELY BEFORE EACH RANGE IS CONSUMED rather than before it is
     * fetched (operator decision, 2026-09-12).
     *
     * WHAT MOVED AND WHY IT IS NOT A WEAKENING. The old loop rechecked, then
     * fetched, then yielded, strictly one range at a time, so finalization
     * spent most of its wall clock waiting on a round trip it could have
     * started earlier. Overlapping the fetches measured 21% faster at depth 3
     * on loopback, and that is a FLOOR: read-ahead hides latency, and hosted
     * round trips are slower than local ones.
     *
     * The thing that was actually being protected is not the fetch, it is the
     * USE. Every range below is authorised at the moment its bytes are handed
     * to the consumer, which is exactly the guarantee the old order gave. What
     * changes is that up to `READ_AHEAD_DEPTH - 1` further ranges may already
     * be in memory, unread, when a revocation lands. Those bytes are ones the
     * service role already holds, they reach no reader, they are dropped
     * unyielded when the recheck fails, and publication rechecks again at
     * `complete_own_upload_finalization_v1`.
     *
     * WHAT IS DELIBERATELY KEPT. One recheck before the pipeline starts, so a
     * lease revoked before this call began fetches nothing at all. That
     * matters for the second caller below (copy verification), which can run
     * long after `begin_own_upload_finalization_v1` authorised the manifest.
     * It costs one round trip per call, not per range.
     */
    const READ_AHEAD_DEPTH = 3;
    async function* ranges(key: string, from = 0) {
      await recheck();
      const queue: { body: Promise<Uint8Array[]> }[] = [];
      let next = from;
      // Returns false when there is nothing left to read, which is what stops
      // the priming loop below. An `enqueue` that simply returned would spin
      // forever on any object smaller than the read-ahead depth, because the
      // queue could never reach it.
      const enqueue = (): boolean => {
        if (next >= lease.expectedSize) return false;
        const start = next;
        const end = Math.min(lease.expectedSize, start + INGEST_CHUNK_MAXIMUM_BYTES) - 1;
        next = end + 1;
        const body = fetchRange(key, start, end);
        // A read-ahead that rejects while an earlier range is still being
        // consumed would otherwise surface as an unhandled rejection and take
        // the process down. The awaited copy below still rejects, so the
        // failure is not swallowed - only its timing is made survivable.
        body.catch(() => {});
        queue.push({ body });
        return true;
      };
      try {
        while (queue.length < READ_AHEAD_DEPTH && enqueue());
        while (queue.length > 0) {
          const parts = await queue.shift()!.body;
          // The authority check for THESE bytes, immediately before they are
          // used and after every earlier range has already been consumed.
          await recheck();
          for (const bytes of parts) yield bytes;
          enqueue();
        }
      } finally {
        // A consumer that stops early - a throw, a `break`, a failed recheck -
        // must not leave fetches running against a lease nobody is using.
        await Promise.allSettled(queue.map(job => job.body));
      }
    }
    // Durable progress (ADR-0026). A request killed mid-flight — the 300-second
    // ceiling is the one that bites — leaves what it finished recorded, so a
    // later retry by the same session resumes instead of transferring the whole
    // object again. An explicit failure still aborts and cleans up below, which
    // retires the checkpoint with the session, exactly as before.
    async function readCheckpoint() {
      const result = await admin.rpc("read_own_upload_finalization_checkpoint_v1", authorization);
      const parsed = finalizationCheckpointReceiptSchema.safeParse(result.data);
      if (result.error || !parsed.success || parsed.data.uploadId !== uploadId) fail();
      return parsed.data;
    }
    async function record(next: FinalizationCheckpoint, revision: number) {
      const result = await admin.rpc("write_own_upload_finalization_checkpoint_v1", {
        ...authorization, p_expected_revision: revision, p_checkpoint: next,
        p_lease_seconds: FINALIZATION_LEASE_SECONDS,
      });
      const parsed = finalizationCheckpointReceiptSchema.safeParse(result.data);
      if (result.error || !parsed.success) fail();
      return parsed.data.revision;
    }
    let { revision, checkpoint } = await readCheckpoint();
    const reached = () => (checkpoint ? finalizationPhaseRank(checkpoint.phase) : 0);
    let evidence: { rawSha256: string; decodedSha256: string };
    if (!checkpoint) {
      // Validation decompresses, so it cannot resume part-way; it runs whole or
      // not at all, and what it proved is recorded rather than repeated.
      evidence = await validateSubjectStructure(ranges(lease.stagingKey), {
        declaredFormat: lease.declaredFormat, expectedSize: lease.expectedSize,
        expectedSha256: lease.expectedSha256, maximumDecodedBytes: lease.maximumDecodedBytes,
      });
      checkpoint = advanceFinalization(null, { phase: "validated", rawSha256: evidence.rawSha256,
        decodedSha256: evidence.decodedSha256, expectedSize: lease.expectedSize });
      revision = await record(checkpoint, revision);
    } else {
      evidence = { rawSha256: checkpoint.rawSha256, decodedSha256: checkpoint.decodedSha256 };
    }
    const advance = (phase: FinalizationCheckpoint["phase"], verifiedBytes?: number, digestState?: string | null) =>
      advanceFinalization(checkpoint, { phase, ...evidence, verifiedBytes, digestState, expectedSize: lease.expectedSize });

    if (reached() < finalizationPhaseRank("copied")) {
      await recheck();
      const copied = await storage.copy(lease.stagingKey, lease.finalKey);
      if (copied.error) fail();
      checkpoint = advance("copied");
      revision = await record(checkpoint, revision);
    }
    if (reached() < finalizationPhaseRank("verified")) {
      // Recompute the complete copy hash; metadata and a copy ACK are insufficient.
      // Plain bytes, so an offset and a saved digest resume it exactly.
      const copyHash = await createSHA256();
      copyHash.init();
      let verified = 0;
      if (checkpoint!.phase === "verifying" && checkpoint!.digestState) {
        copyHash.load(Buffer.from(checkpoint!.digestState, "base64"));
        verified = checkpoint!.verifiedBytes;
      }
      for await (const bytes of ranges(lease.finalKey, verified)) { copyHash.update(bytes); verified += bytes.length; }
      if (verified !== lease.expectedSize || copyHash.digest("hex") !== evidence.rawSha256) {
        throw new SubjectStructureError("upload_integrity_mismatch");
      }
      checkpoint = advance("verified", lease.expectedSize);
      revision = await record(checkpoint, revision);
    }
    if (reached() < finalizationPhaseRank("staging-removed")) {
      await recheck();
      const removed = await storage.remove([lease.stagingKey]);
      if (removed.error) fail();
      checkpoint = advance("staging-removed", lease.expectedSize);
      // Last phase to record; publication below is the only step after it.
      await record(checkpoint, revision);
    }
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
      // Structural validation raises `too_large` for one cause only: decoded
      // content past the session ceiling. The stored size already passed at
      // issuance, so reporting a plain size limit here would name the wrong
      // measurement and invite pointless refiltering of a valid file.
      if (error.code === "too_large") return ownUploadJson({ error: "decompressed_too_large" }, status);
      return ownUploadJson(error.code === "subject_source_not_single_sample"
        ? { error: error.code, messageCopyId: "upload.subject.single-sample-required" } : { error: error.code }, status);
    }
    return ownUploadJson({ error: "unavailable" }, 503);
  }
}
