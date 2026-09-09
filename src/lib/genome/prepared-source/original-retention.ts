import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createAdminClient } from "../../supabase/admin";
import { preparedStorageConfig } from "./storage-common";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const claimSchema = z.object({ version: z.literal("own-original-retirement-v1"), fileId: uuid, manifestId: uuid,
  objectId: uuid, bucket: z.literal("genomes"), objectKey: uuid, storageVersion: uuid,
  byteCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }), claimExpiresAt: z.iso.datetime({ offset: true }) }).strict();
type Result = { data: unknown; error: unknown };
type Rpc = (name: string, args: Record<string, unknown>) => { abortSignal(signal: AbortSignal): PromiseLike<Result> };
/** One due, database-selected known original version. Completion requires the
 * exact nonempty Storage DELETE ACK, whose pinned provider implementation waits
 * for the versioned backend deletion within its DB transaction. A lost/empty ACK
 * remains unconfirmed; metadata absence alone is not deletion evidence. */
export async function drainOwnOriginalRetirement(admin: ReturnType<typeof createAdminClient>, external: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([external, AbortSignal.timeout(25_000), controller.signal]);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined, claimDeadline = Infinity;
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, closed = false;
  const active = () => { signal.throwIfAborted(); if (Date.now() >= claimDeadline) throw new Error("original_retirement_unavailable"); };
  function close() {
    if (closed) return; closed = true; controller.abort();
    try { if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      else if (response) void response.body?.cancel().catch(() => {}); } catch { /* bounded best effort */ }
  }
  async function wait<T>(operation: PromiseLike<T>): Promise<T> {
    const pending = Promise.resolve(operation);
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error("original_retirement_unavailable")); signal.addEventListener("abort", abort, { once: true }); });
    try { const result = await Promise.race([pending, cancelled]); active(); return result; }
    finally { signal.removeEventListener("abort", abort); }
  }
  const token = createHash("sha256").update(randomBytes(32)).digest("hex");
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  async function call(name: string, args: Record<string, unknown>) {
    active(); const response = await wait(rpc(name, args).abortSignal(signal)); active();
    if (response.error) throw new Error("original_retirement_unavailable"); assertPreparedMetadataBounds(response.data, 16384); return response.data;
  }
  try {
    const raw = await call("claim_own_original_retirement_v1", { p_claim_token_hash: token });
    if (raw === null) return { processed: 0, failed: 0 };
    const claim = claimSchema.parse(raw);
    if (Date.parse(claim.expiresAt) > Date.now() || Date.parse(claim.claimExpiresAt) <= Date.now()) throw new Error("original_retirement_unavailable");
    claimDeadline = Date.parse(claim.claimExpiresAt);
    deadlineTimer = setTimeout(() => controller.abort(), Math.max(0, claimDeadline - Date.now())); deadlineTimer.unref();
    const args = { p_file_id: claim.fileId, p_claim_token_hash: token };
    const current = claimSchema.parse(await call("check_own_original_retirement_v1", args));
    if (!isDeepStrictEqual(claim, current)) throw new Error("original_retirement_unavailable");
    const config = preparedStorageConfig();
    active();
    response = await wait(fetch(`${config.origin}/storage/v1/object/genomes`, { method: "DELETE", redirect: "error", cache: "no-store", signal,
      headers: { authorization: `Bearer ${config.key}`, apikey: config.key, "content-type": "application/json", "accept-encoding": "identity" },
      body: JSON.stringify({ prefixes: [claim.objectKey] }) }).then(result => { response = result; if (closed || signal.aborted) void result.body?.cancel().catch(() => {}); return result; }));
    if (!response || response.status !== 200 || response.headers.has("content-range") || ![null, "identity"].includes(response.headers.get("content-encoding"))) {
      close(); throw new Error("original_retirement_unavailable");
    }
    reader = response.body?.getReader(); if (!reader) throw new Error("original_retirement_unavailable");
    let text = "", count = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { for (;;) { active(); const part = await wait(reader.read()); active(); if (part.done) break;
      count += part.value.byteLength; if (count > 16384) throw new Error("original_retirement_unavailable"); text += decoder.decode(part.value, { stream: true }); }
      text += decoder.decode();
    } finally { try { void reader.cancel().catch(() => {}); reader.releaseLock(); } catch { /* preserve original failure */ } reader = undefined; }
    const observed: unknown = JSON.parse(text); assertPreparedMetadataBounds(observed, 16384);
    // Provider object schema may contain ordinary bounded metadata. Only this
    // exact object's ID/key/version/size is accepted as deletion observation.
    const rows = z.array(z.object({ id: uuid, name: uuid, bucket_id: z.literal("genomes"), version: uuid,
      metadata: z.object({ size: z.number().int().positive() }).passthrough() }).passthrough()).length(1).parse(observed);
    const row = rows[0]; if (row.id !== claim.objectId || row.name !== claim.objectKey || row.version !== claim.storageVersion || row.metadata.size !== claim.byteCount) throw new Error("original_retirement_unavailable");
    const evidence = { version: "own-original-delete-evidence-v1", provider: "supabase", disposition: "original-payload-deleted",
      objectId: claim.objectId, objectKey: claim.objectKey, storageVersion: claim.storageVersion, byteCount: claim.byteCount, sha256: claim.sha256 };
    if (await call("finish_own_original_retirement_v1", { ...args, p_expected: claim, p_evidence: evidence }) !== true) throw new Error("original_retirement_unavailable");
    return { processed: 1, failed: 0 };
  } catch { return { processed: 0, failed: 1 }; }
  finally { if (deadlineTimer) clearTimeout(deadlineTimer); close(); }
}
