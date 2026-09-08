import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PREPARED_CONTAINER_MAX_BYTES } from "./containers";
import { preparedObjectKeySchema, preparedStorageConfig } from "./storage-common";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const claimSchema = z.object({ jobId: uuid, attemptId: uuid, claimTokenHash: hash }).strict();
const descriptorSchema = z.object({ kind: z.literal("container"),
  sequence: z.number().int().min(0).max(4095),
  byteCount: z.number().int().min(1).max(PREPARED_CONTAINER_MAX_BYTES), sha256: hash }).strict();
const receiptSchema = z.object({ version: z.literal("own-preparation-artifact-v1"),
  artifactId: uuid, jobId: uuid, attemptId: uuid, sequence: descriptorSchema.shape.sequence,
  bucket: z.literal("genomes"), objectKey: preparedObjectKeySchema,
  byteCount: descriptorSchema.shape.byteCount, sha256: hash,
  writeExpiresAt: z.iso.datetime({ offset: true }),
}).strict();
export type PreparedArtifactReceipt = z.infer<typeof receiptSchema>;
export { receiptSchema as preparedArtifactReceiptSchema };
export type PreparedStoredArtifact = { receipt: PreparedArtifactReceipt; storageObjectId: string };
export type PreparedArtifactDescriptor = z.infer<typeof descriptorSchema>;
export class PreparedStorageWriteError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_state" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedStorageWriteError";
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function active(signal: AbortSignal) {
  if (signal.aborted) throw new PreparedStorageWriteError("aborted");
}
async function wait<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); active(signal); }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new PreparedStorageWriteError("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { const value = await Promise.race([pending, cancelled]); active(signal); return value; }
  finally { signal.removeEventListener("abort", abort); }
}

/** Includes actual EOF, not just the expected prefix. Cancels failed/stalled
 * bodies; never trusts a provider's declared length as an allocation size. */
async function body(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) throw new PreparedStorageWriteError("integrity_mismatch");
  const reader = response.body.getReader(), bytes = new Uint8Array(maximum);
  let count = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    active(signal);
    for (;;) {
      const chunk = await wait(reader.read(), signal);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > maximum - count)
        throw new PreparedStorageWriteError("integrity_mismatch");
      bytes.set(chunk.value, count); count += chunk.value.length;
    }
    return bytes.subarray(0, count);
  } finally {
    signal.removeEventListener("abort", cancel); cancel(); reader.releaseLock();
  }
}

/** Server-only, serial create-only transport for an already claimed job.
 * Reserve BEFORE sending bytes; GET the full stored object and hash through
 * EOF; ACK only that exact registered receipt/object identity. SQL rechecks the
 * captured source/session/attempt. Caller must bind encoded contents to that
 * source and validate the run/manifest before any publication.
 *
 * Never retries. Failure or abort after reservation is UNCERTAIN: the provider
 * can finish after cancellation. The database retains the reservation for the
 * job's freeze/cleanup lifecycle. This function neither deletes an uncertain
 * upload nor claims physical absence, and is not wired to dispatch yet.
 */
export function createPreparedArtifactWriter(rawClaim: z.infer<typeof claimSchema>) {
  let claim: z.infer<typeof claimSchema>, origin: string, key: string;
  try { claim = claimSchema.parse(rawClaim); }
  catch { throw new PreparedStorageWriteError("invalid_request"); }
  try { ({ origin, key } = preparedStorageConfig()); }
  catch { throw new PreparedStorageWriteError("unavailable"); }
  const claimArgs = { p_job_id: claim.jobId, p_attempt_id: claim.attemptId, p_claim_token_hash: claim.claimTokenHash };
  let busy = false, failed = false;
  return async (input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, external?: AbortSignal):
    Promise<PreparedStoredArtifact> => {
    if (busy || failed) throw new PreparedStorageWriteError("invalid_state");
    let descriptor: PreparedArtifactDescriptor, owned: Uint8Array;
    try {
      descriptor = descriptorSchema.parse(input.descriptor);
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== descriptor.byteCount) throw new Error();
      owned = Uint8Array.from(input.bytes);
      if (sha(owned) !== descriptor.sha256) throw new Error();
    } catch { throw new PreparedStorageWriteError("invalid_request"); }
    busy = true;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), 30_000); timer.unref();
    let leaseTimer: ReturnType<typeof setTimeout> | undefined;
    const signal = external ? AbortSignal.any([external, deadline.signal]) : deadline.signal;
    async function request(path: string, init: RequestInit): Promise<Response> {
      active(signal);
      let resolved: Response | undefined, cancelled = false;
      const cancel = () => {
        if (resolved && !cancelled) { cancelled = true; void resolved.body?.cancel().catch(() => {}); }
      };
      const pending = fetch(`${origin}${path}`, { ...init, signal, cache: "no-store", redirect: "error",
        headers: { Authorization: `Bearer ${key}`, apikey: key, ...init.headers } });
      void pending.then(late => { resolved = late; if (signal.aborted) cancel(); }, () => {});
      let response: Response;
      try { response = await wait(pending, signal); }
      catch (error) { cancel(); throw error; }
      if (!response.ok) {
        cancel();
        throw new PreparedStorageWriteError("unavailable");
      }
      return response;
    }
    async function json(response: Response): Promise<unknown> {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await body(response, 16_384, signal)));
    }
    async function rpc(name: string, args: object): Promise<unknown> {
      return json(await request(`/rest/v1/rpc/${name}`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) }));
    }
    try {
      active(signal);
      const receipt = receiptSchema.parse(await rpc("reserve_own_preparation_artifact_v1", {
        ...claimArgs, p_descriptor: descriptor,
      }));
      if (receipt.jobId !== claim.jobId || receipt.attemptId !== claim.attemptId
        || receipt.sequence !== descriptor.sequence || receipt.byteCount !== descriptor.byteCount
        || receipt.sha256 !== descriptor.sha256) throw new PreparedStorageWriteError("integrity_mismatch");
      const remaining = Date.parse(receipt.writeExpiresAt) - Date.now();
      if (remaining <= 0) throw new PreparedStorageWriteError("unavailable");
      leaseTimer = setTimeout(() => deadline.abort(), Math.min(remaining, 30_000)); leaseTimer.unref();
      const uploaded = z.object({ Id: uuid, Key: z.literal(`genomes/${receipt.objectKey}`) }).strict().parse(
        await json(await request(`/storage/v1/object/genomes/${receipt.objectKey}`, { method: "POST",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(owned.length),
            "Cache-Control": "max-age=0", "x-upsert": "false" }, body: owned as BodyInit })),
      );
      z.object({ version: z.literal("own-preparation-claim-v1"),
        jobId: z.literal(claim.jobId), attemptId: z.literal(claim.attemptId) }).passthrough().parse(
        await rpc("check_own_preparation_claim_v1", claimArgs));
      const response = await request(`/storage/v1/object/authenticated/genomes/${receipt.objectKey}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      if (response.status !== 200 || response.headers.has("content-range")
        || (response.headers.has("content-length") && response.headers.get("content-length") !== String(owned.length))
        || (response.headers.has("content-encoding") && response.headers.get("content-encoding") !== "identity")) {
        void response.body?.cancel().catch(() => {});
        throw new PreparedStorageWriteError("integrity_mismatch");
      }
      const observed = await body(response, descriptor.byteCount, signal);
      if (observed.byteLength !== descriptor.byteCount || sha(observed) !== descriptor.sha256)
        throw new PreparedStorageWriteError("integrity_mismatch");
      const acknowledged = receiptSchema.parse(await rpc("ack_own_preparation_artifact_v1", {
        ...claimArgs, p_artifact_id: receipt.artifactId, p_storage_object_id: uploaded.Id,
        p_expected_receipt: receipt, p_observed_sha256: sha(observed),
      }));
      if (!isDeepStrictEqual(receipt, acknowledged)) throw new PreparedStorageWriteError("integrity_mismatch");
      active(signal);
      return { receipt, storageObjectId: uploaded.Id };
    } catch (error) {
      failed = true;
      if (signal.aborted) throw new PreparedStorageWriteError("aborted");
      if (error instanceof PreparedStorageWriteError) throw error;
      throw new PreparedStorageWriteError("unavailable");
    } finally {
      clearTimeout(timer); if (leaseTimer) clearTimeout(leaseTimer); busy = false;
    }
  };
}
