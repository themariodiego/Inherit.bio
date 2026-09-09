import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import register from "../../../docs/route-register.json";
import { createAdminClient } from "../supabase/admin";
import { preparedStorageConfig } from "../genome/prepared-source/storage-common";
import { createPreparedArtifactWriter } from "../genome/prepared-source/storage-writer";
import { createPreparedArtifactFetch } from "../genome/prepared-source/storage-artifact-fetch";
import { preparedStoredArtifactSchema } from "../genome/prepared-source/artifact-identity";
import { runOwnPreparationPipeline, type OwnPreparationCheckpoint } from "./own-preparation-pipeline";
import { ownPreparationOriginalSchema } from "./own-preparation-source";

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/), date = z.iso.datetime({ offset: true });
const claimSchema = z.object({ version: z.literal("own-preparation-claim-v1"), jobId: uuid, attemptId: uuid,
  claimExpiresAt: date, jobDeadline: date, source: ownPreparationOriginalSchema,
  authority: z.record(z.string(), z.unknown()) }).strict();
const workSchema = z.object({ claim: claimSchema, actor: z.object({ accountId: uuid, sessionId: uuid }).strict() }).strict();
const checkpointSchema = z.object({ version: z.literal("own-preparation-checkpoint-receipt-v1"), jobId: uuid, attemptId: uuid,
  revision: z.number().int().min(0).max(1_000_000), nextArtifactSequence: z.number().int().min(0).max(4096),
  checkpoint: z.unknown() }).strict();
const publishedSchema = z.object({ version: z.literal("own-prepared-source-v1"), backend: z.literal("prepared-object-v1"),
  manifestId: uuid, fileId: uuid, subjectId: uuid, sourceRevision: z.number().int().positive(), rawSha256: hash,
  decodedSha256: hash, preparedAt: date, root: preparedStoredArtifactSchema, summary: z.unknown(),
  memberCount: z.number().int().min(1).max(4096), membershipSha256: hash }).strict();
type Rpc = (name: string, args: Record<string, unknown>) => {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
};
export class OwnPreparationWorkerError extends Error {
  constructor(readonly code: "unavailable" | "integrity_mismatch" | "aborted") {
    super(code); this.name = "OwnPreparationWorkerError";
  }
}
const fail = (code: OwnPreparationWorkerError["code"]): never => { throw new OwnPreparationWorkerError(code); };

/** One real FIFO claim, no global drain loop and no analysis generation. Intended
 * for an awaited long-lived server worker, NOT detached Vercel request work.
 * SQL admission must be enabled independently; this adapter never enables it.
 *
 * Checkpoints are durable only for this live attempt. This invocation owns its
 * unlogged random claim hash; a process crash loses it and requires the existing
 * freeze/cleanup/replay lifecycle. No hidden attempt adoption or write retry.
 * Publication response uncertainty is also never retried here. Cleanup must use
 * the full registered job, including acknowledged and uncertain scratch writes.
 */
export async function runNextOwnPreparation(options: { signal?: AbortSignal; expectedFileId?: string } = {}): Promise<
  { status: "idle" } | { status: "prepared"; fileId: string; jobId: string; manifestId: string }> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let operationTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  let stopped = false;
  const active = () => { if (signal.aborted) fail("aborted"); };
  async function wait<T>(pending: PromiseLike<T>, current = signal): Promise<T> {
    const started = Promise.resolve(pending);
    if (current.aborted) { void started.catch(() => {}); fail("aborted"); }
    let abort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new OwnPreparationWorkerError("aborted"));
      current.addEventListener("abort", abort, { once: true });
    });
    try { const value = await Promise.race([started, interrupted]); if (current.aborted) fail("aborted"); return value; }
    finally { current.removeEventListener("abort", abort); }
  }
  try {
    active();
    if (options.expectedFileId !== undefined && !uuid.safeParse(options.expectedFileId).success) fail("integrity_mismatch");
    const config = preparedStorageConfig(), admin = createAdminClient();
    const call = admin.rpc.bind(admin) as unknown as Rpc;
    async function rpc(name: string, args: Record<string, unknown>, current = signal) {
      active();
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 30_000); timer.unref();
      const bounded = AbortSignal.any([current, signal, timeout.signal]);
      try {
        const result = await wait(call(name, args).abortSignal(bounded), bounded);
        if (result.error) fail("unavailable");
        return result.data;
      } finally { clearTimeout(timer); }
    }
    const claimTokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const raw = await rpc("claim_next_own_preparation_work_v1", { p_claim_token_hash: claimTokenHash });
    if (raw === null) return { status: "idle" };
    const { claim, actor } = workSchema.parse(raw);
    if (options.expectedFileId && options.expectedFileId !== claim.source.fileId) fail("integrity_mismatch");
    const hardRemaining = Date.parse(claim.jobDeadline) - Date.now();
    if (hardRemaining <= 0 || hardRemaining > 3_600_000) fail("integrity_mismatch");
    operationTimer = setTimeout(() => controller.abort(), hardRemaining); operationTimer.unref();
    const args = { p_job_id: claim.jobId, p_attempt_id: claim.attemptId, p_claim_token_hash: claimTokenHash };
    function validateClaim(raw: unknown) {
      const current = claimSchema.parse(raw);
      if (current.jobId !== claim.jobId || current.attemptId !== claim.attemptId
        || current.jobDeadline !== claim.jobDeadline || !equal(current.source, claim.source)
        || !equal(current.authority, claim.authority)) fail("integrity_mismatch");
      const remaining = Math.min(Date.parse(current.claimExpiresAt), Date.parse(current.jobDeadline)) - Date.now();
      if (remaining <= 0 || Date.parse(current.claimExpiresAt) > Date.parse(current.jobDeadline)) fail("unavailable");
      return remaining;
    }
    function armLease(remaining: number) {
      if (leaseTimer) clearTimeout(leaseTimer);
      leaseTimer = setTimeout(() => controller.abort(), remaining); leaseTimer.unref();
    }
    armLease(validateClaim(claim));
    function scheduleRenewal() {
      if (stopped) return;
      renewTimer = setTimeout(() => {
        renewal = (async () => {
          const current = await rpc("renew_own_preparation_claim_v1", args);
          const remaining = validateClaim(current); active(); armLease(remaining);
        })();
        void renewal.then(() => { renewal = undefined; scheduleRenewal(); }, () => { controller.abort(); });
      }, 120_000); renewTimer.unref();
    }
    scheduleRenewal();
    async function check(current = signal) {
      validateClaim(await rpc("check_own_preparation_claim_v1", args, current));
    }
    function checkedCheckpoint(raw: unknown) {
      const receipt = checkpointSchema.parse(raw);
      if (receipt.jobId !== claim.jobId || receipt.attemptId !== claim.attemptId) fail("integrity_mismatch");
      return receipt;
    }
    let checkpoint = checkedCheckpoint(await rpc("read_own_preparation_checkpoint_v1", args));
    // A newly claimed attempt must start empty. Resumption of another process's
    // bearer is deliberately not an input to this public server helper.
    if (checkpoint.revision !== 0 || checkpoint.checkpoint !== null || checkpoint.nextArtifactSequence !== 0)
      fail("integrity_mismatch");
    const chain = await wait(readFile(path.join(process.cwd(), "data/ref/chain/GRCh37_to_GRCh38.chain.gz")));
    const writeArtifact = createPreparedArtifactWriter({ jobId: claim.jobId, attemptId: claim.attemptId, claimTokenHash });
    const result = await runOwnPreparationPipeline({ jobId: claim.jobId, attemptId: claim.attemptId,
      firstArtifactSequence: 0, signal, liftover: { chainBytes: chain, sha256: createHash("sha256").update(chain).digest("hex") },
      maximumUnmappedFraction: register.policyContracts["genome-liftover-v1"].maximumUnmappedFraction,
      original: { source: claim.source, signal, check: async (source, current) => {
        if (!equal(source, claim.source)) fail("integrity_mismatch"); await check(current);
      }, readRange: (source, start, end, current) => fetch(`${config.origin}/storage/v1/object/authenticated/genomes/${source.objectKey}`, {
        method: "GET", signal: current, cache: "no-store", redirect: "error",
        headers: { Authorization: `Bearer ${config.key}`, apikey: config.key, Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" },
      }) },
      writeArtifact, readArtifact: createPreparedArtifactFetch(),
      check: async (artifact, current) => {
        if (!artifact) { await check(current); return; }
        const parsed = preparedStoredArtifactSchema.parse(await rpc("check_own_preparation_artifact_v1", {
          ...args, p_expected_artifact: artifact }, current));
        if (!equal(parsed, artifact)) fail("integrity_mismatch");
      },
      checkpoint: async (next: OwnPreparationCheckpoint, current) => {
        const saved = checkedCheckpoint(await rpc("write_own_preparation_checkpoint_v1", {
          ...args, p_expected_revision: checkpoint.revision, p_checkpoint: next }, current));
        if (saved.revision !== checkpoint.revision + 1 || saved.nextArtifactSequence !== next.nextArtifactSequence
          || !equal(saved.checkpoint, next)) fail("integrity_mismatch");
        checkpoint = saved; return next;
      },
    });
    // Settle renewal before terminal publication; no background renewal may
    // interpret the legitimate published transition as a failed live claim.
    stopped = true; if (renewTimer) clearTimeout(renewTimer);
    if (renewal) await wait(renewal);
    await check();
    const published = publishedSchema.parse(await rpc("publish_own_prepared_manifest_v1", {
      ...args, p_account_id: actor.accountId, p_session_id: actor.sessionId, p_payload: result.publication.payload,
    }));
    if (published.fileId !== claim.source.fileId || published.subjectId !== claim.source.subjectId
      || published.sourceRevision !== claim.source.sourceRevision || published.rawSha256 !== claim.source.rawSha256
      || published.decodedSha256 !== claim.source.decodedSha256 || !equal(published.root, result.publication.rootArtifact)
      || !equal(published.summary, result.publication.payload.summary)
      || published.memberCount !== result.publication.members.length) fail("integrity_mismatch");
    active();
    return { status: "prepared", fileId: published.fileId, jobId: claim.jobId, manifestId: published.manifestId };
  } catch (error) {
    if (signal.aborted) fail("aborted");
    if (error instanceof OwnPreparationWorkerError) throw error;
    return fail("unavailable");
  } finally {
    stopped = true;
    if (renewTimer) clearTimeout(renewTimer);
    if (leaseTimer) clearTimeout(leaseTimer);
    if (operationTimer) clearTimeout(operationTimer);
    controller.abort();
    // A rejected late renewal is already observed; no cancellation implies a
    // provider-side rollback and no secrets are copied into diagnostics.
  }
}
