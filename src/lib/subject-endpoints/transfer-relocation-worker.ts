import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { createAdminClient } from "@/lib/supabase/admin";
import { readGenomeObjectRange } from "@/lib/uploads/subject-original-download";
import {
  RelocationWorkerError, runNextFuturePersonRelocation, type RelocationResult, type RelocationRpc,
} from "@/lib/future-person/relocation-worker";

/**
 * The subject-transfer branch of workerExecutionBindings.subject-object-
 * relocation (owner decisions of 2026-10-16: a transferred adult record's
 * files are detached into person-owned files, and each object is copied to a
 * fresh flat `<uuid>` key, as live code uses). Every unit of work is one
 * exact database row; the database chooses the bucket, both keys, the size
 * and the hash, and nothing here takes a path from anywhere else.
 *
 *   copy:    claim the row (a five-minute lease and its own fresh key),
 *            recheck, copy, recheck, read back every byte and hash it,
 *            recheck, then swap the file's reference in one transaction.
 *            Any failure fences the attempt, so only its own new key is
 *            later disposed of; the old object and reference are untouched.
 *   retire:  only after a committed swap, delete the exact old object, then
 *            let the database prove it is gone.
 *   dispose: delete a fenced attempt's own new key, then let the database
 *            prove it is gone.
 *
 * TEST-LOCAL only, like the rest of Path B.
 */

const uuid = z.uuid().regex(/^[0-9a-f-]+$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const workSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("copy"), relocationId: uuid }).strict(),
  z.object({ kind: z.literal("retire"), relocationId: uuid }).strict(),
  z.object({ kind: z.literal("dispose"), attemptId: uuid }).strict(),
]);
export const transferRelocationTargetSchema = z.object({
  relocationId: uuid, attemptId: uuid, bucket: z.literal("genomes"), oldKey: uuid, newKey: uuid,
  byteCount: z.number().int().positive().safe(), sha256: digest, expiresAt: z.iso.datetime({ offset: true }),
}).strict().refine(value => value.newKey === value.attemptId && value.newKey !== value.oldKey);
export type TransferRelocationTarget = z.infer<typeof transferRelocationTargetSchema>;
const retireSchema = z.object({ relocationId: uuid, bucket: z.literal("genomes"), key: uuid }).strict();
const disposeSchema = z.object({ attemptId: uuid, bucket: z.literal("genomes"), key: uuid }).strict()
  .refine(value => value.key === value.attemptId);

/** The object operations one branch needs, each on the private genomes bucket. */
export type TransferStorage = {
  copy(from: string, to: string, signal: AbortSignal): Promise<void>;
  objectId(key: string, signal: AbortSignal): Promise<string>;
  digest(key: string, byteCount: number, signal: AbortSignal): Promise<{ bytes: number; sha256: string }>;
  remove(key: string, signal: AbortSignal): Promise<void>;
};

const READ_RANGE_BYTES = 8 * 1024 * 1024;
const token = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const fail = (): never => { throw new RelocationWorkerError(); };

/** Supabase Storage, service-authenticated. The full read-back is ranged, so memory stays bounded. */
export function supabaseTransferStorage(): TransferStorage {
  const bucket = () => createAdminClient().storage.from("genomes");
  return {
    async copy(from, to, signal) {
      if (signal.aborted) fail();
      const { error } = await bucket().copy(from, to);
      if (error) fail();
    },
    async objectId(key, signal) {
      if (signal.aborted) fail();
      const { data, error } = await bucket().info(key);
      const id = uuid.safeParse(data?.id);
      return error || !id.success ? fail() : id.data;
    },
    async digest(key, byteCount, signal) {
      const hash = createHash("sha256");
      let offset = 0;
      while (offset < byteCount) {
        const end = Math.min(byteCount, offset + READ_RANGE_BYTES) - 1;
        const response = await readGenomeObjectRange(key, offset, end, signal);
        if (response.status !== 206 || !response.body
          || response.headers.get("content-range") !== `bytes ${offset}-${end}/${byteCount}`) {
          await response.body?.cancel().catch(() => {});
          fail();
        }
        let received = 0;
        for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += part.byteLength;
          if (received > end - offset + 1) fail();
          hash.update(part);
        }
        if (received !== end - offset + 1) fail();
        offset = end + 1;
      }
      return { bytes: offset, sha256: hash.digest("hex") };
    },
    async remove(key, signal) {
      if (signal.aborted) fail();
      const { data, error } = await bucket().remove([key]);
      // An empty list is Storage's idempotent answer for an object already gone.
      if (error || !Array.isArray(data)) fail();
    },
  };
}

/** One unit of subject-transfer relocation work, or "idle". */
export async function runNextSubjectTransferRelocation(options: {
  signal: AbortSignal; rpc?: RelocationRpc; storage?: TransferStorage;
}): Promise<RelocationResult> {
  if (!isTestJurisdictionEnabled()) throw new RelocationWorkerError();
  const rpc = options.rpc ?? (() => { const admin = createAdminClient(); return admin.rpc.bind(admin) as RelocationRpc; })();
  const storage = options.storage ?? supabaseTransferStorage();
  const call = async (name: string, args: Record<string, unknown>, signal = options.signal) => {
    const result = await rpc(name, { ...args, p_test_jurisdiction: true }).abortSignal(signal);
    if (result.error) throw new RelocationWorkerError();
    return result.data;
  };
  const raw = await call("subject_transfer_relocation_work_v1", {});
  if (raw === null) return "idle";
  const work = workSchema.parse(raw);

  if (work.kind === "retire") {
    const hash = token();
    const rawReceipt = await call("claim_subject_transfer_retirement_v1", { p_relocation_id: work.relocationId, p_token_hash: hash });
    if (rawReceipt === null) return "idle";
    const receipt = retireSchema.parse(rawReceipt);
    if (receipt.relocationId !== work.relocationId) fail();
    await storage.remove(receipt.key, options.signal);
    if (await call("finish_subject_transfer_retirement_v1", { p_relocation_id: receipt.relocationId, p_token_hash: hash }) !== true) fail();
    return "complete";
  }

  if (work.kind === "dispose") {
    const hash = token();
    const rawReceipt = await call("claim_subject_transfer_disposal_v1", { p_attempt_id: work.attemptId, p_token_hash: hash });
    if (rawReceipt === null) return "idle";
    const receipt = disposeSchema.parse(rawReceipt);
    if (receipt.attemptId !== work.attemptId) fail();
    await storage.remove(receipt.key, options.signal);
    if (await call("finish_subject_transfer_disposal_v1", { p_attempt_id: receipt.attemptId, p_token_hash: hash }) !== true) fail();
    return "cleaned";
  }

  const hash = token();
  const rawTarget = await call("claim_subject_transfer_relocation_v1", { p_relocation_id: work.relocationId, p_token_hash: hash });
  if (rawTarget === null) return "idle";
  let attemptId: string | null = null;
  try {
    const target = transferRelocationTargetSchema.parse(rawTarget);
    attemptId = target.attemptId;
    if (target.relocationId !== work.relocationId) fail();
    const claim = { p_attempt_id: target.attemptId, p_token_hash: hash };
    const current = async () => {
      if (!isTestJurisdictionEnabled() || await call("check_subject_transfer_relocation_v1", claim) !== true) fail();
    };
    await current();
    await storage.copy(target.oldKey, target.newKey, options.signal);
    await current();
    const copied = await storage.digest(target.newKey, target.byteCount, options.signal);
    if (copied.bytes !== target.byteCount || copied.sha256 !== target.sha256) fail();
    await current();
    const objectId = await storage.objectId(target.newKey, options.signal);
    if (await call("swap_subject_transfer_relocation_v1", { ...claim, p_new_object_id: objectId,
      p_byte_count: copied.bytes, p_sha256: copied.sha256 }) !== true) fail();
    return "swapped";
  } catch {
    // The fence selects only this uncommitted attempt. If the swap committed
    // and its answer was lost, the database refuses the fence, and the next
    // work call retires only the old object.
    if (attemptId) {
      try { await call("fence_subject_transfer_relocation_v1", { p_attempt_id: attemptId, p_token_hash: hash }, AbortSignal.timeout(30000)); }
      catch { /* the lease expires and the next work call fences it */ }
    }
    return "failure_pending";
  }
}

let turn = 0;

/**
 * The registered subject-object-relocation worker: the claimant-bind branch
 * and the subject-transfer branch take turns going first, so a failing item
 * on one side never starves the other. A branch that fails does not stop
 * the other from running; the failure is still reported.
 */
export async function runNextSubjectObjectRelocation(options: {
  signal: AbortSignal;
  futurePerson?: (options: { signal: AbortSignal }) => Promise<RelocationResult>;
  transfer?: (options: { signal: AbortSignal }) => Promise<RelocationResult>;
}): Promise<RelocationResult> {
  const branches = [options.futurePerson ?? runNextFuturePersonRelocation, options.transfer ?? runNextSubjectTransferRelocation];
  const order = turn++ % 2 === 0 ? branches : [...branches].reverse();
  let failed = false;
  for (const branch of order) {
    try {
      const result = await branch({ signal: options.signal });
      if (result !== "idle") return result;
    } catch {
      if (options.signal.aborted) throw new RelocationWorkerError();
      failed = true;
    }
  }
  if (failed) throw new RelocationWorkerError();
  return "idle";
}
