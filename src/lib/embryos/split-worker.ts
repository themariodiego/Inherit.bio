import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createAdminClient } from "../supabase/admin";
import { embryoR2WriteTargetSchema, type EmbryoFragmentRpc, type EmbryoR2WriteTarget,
  type EmbryoStoredFragment } from "./fragment-storage";
import { EmbryoTransportError } from "./ingest-lines";
import { addMeasures, analyseEmbryoFragment, embryoOrdinalOutcome, emptyMeasure,
  type EmbryoSplitRow } from "./split-analysis";

/**
 * The `split_cohort_vcf` consumer (register `workerExecutionBindings.
 * embryo-sanitization`). One FIFO claim per call, for an awaited operator
 * process, never request work. TEST-LOCAL only: the database refuses every
 * claim until `private.embryo_split_config` is enabled, and the loop that
 * calls this refuses to start outside the test jurisdiction.
 *
 * For each embryo ordinal, in order: recheck the claim, read each of that
 * embryo's fragments, prove its size and SHA-256 against the locked manifest,
 * revalidate and parse it with the product parser, stage its validated rows,
 * then record its QC outcome in its own transaction. An embryo that fails QC
 * keeps only a closed reason and the job continues. An embryo that passes is
 * recorded only after its canonical source has landed: each of its fragments
 * is read and verified again and copied byte for byte into a new R2 object,
 * reserved and acknowledged under the live claim. No object is ever written
 * for an embryo that fails. When every embryo has an outcome, one terminal
 * transaction (`publish_embryo_split_v1`) publishes the whole cohort at once,
 * binding each pass to its own canonical source and `genome_files` row;
 * nothing is visible before it commits.
 *
 * Fragment bytes come through `EmbryoFragmentReader`, keyed only by
 * (session, sequence, ordinal). The fragment store behind it (R2 under ADR
 * 0025, built by the safeguards work) decides where the landed version lives
 * and returns exactly those bytes; this worker never sees an object name and
 * re-verifies every byte against the manifest it claimed.
 *
 * The random claim token lives only in this invocation's memory. A crash
 * loses it; the lease lapses and a later claim starts a fresh attempt that
 * discards this one's pending rows. There is no write retry and no adoption
 * of another attempt. No identifier, object name, genotype or error body is
 * ever logged or returned beyond the closed result below.
 */

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/), date = z.iso.datetime({ offset: true });
const fragmentSchema = z.object({ ordinal: z.number().int().min(0).max(63), sequence: z.number().int().min(0).max(49),
  byteCount: z.number().int().min(1).max(4_004_096), sha256: hash, lineCount: z.number().int().min(1) }).strict();
const claimSchema = z.object({ version: z.literal("embryo-split-claim-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), claimExpiresAt: date, deadline: date, sessionId: uuid, cohortId: uuid,
  format: z.literal("vcf"), build: z.enum(["GRCh37", "GRCh38"]), embryoCount: z.number().int().min(1).max(64),
  manifestSha256: hash, fragments: z.array(fragmentSchema).min(1).max(3200) }).strict();
const leaseSchema = z.object({ version: z.literal("embryo-split-lease-v1"), jobId: uuid,
  attempt: z.number().int().min(1).max(20), claimExpiresAt: date, deadline: date, sessionId: uuid,
  manifestSha256: hash }).strict();
const fragmentReadSchema = z.object({ version: z.literal("embryo-split-fragment-v1"), sessionId: uuid,
  ordinal: z.number().int().min(0).max(63), sequence: z.number().int().min(0).max(49),
  byteCount: z.number().int().min(1).max(4_004_096), sha256: hash,
  landed: z.object({ backend: z.enum(["r2", "supabase"]) }).loose() }).strict();
const failureSchema = z.object({ status: z.literal("failure_pending"), cohortId: uuid,
  ingestRevision: z.number().int().positive(), failureCode: z.string() }).strict();
const stagedSchema = z.object({ status: z.literal("staged"), batch: z.number().int().min(0), rows: z.number().int().min(1) }).strict();
const recordedSchema = z.object({ status: z.literal("recorded"), ordinal: z.number().int().min(0),
  outcome: z.enum(["passed", "qc_fail_no_source"]), remaining: z.number().int().min(0) }).strict();
const failReportSchema = z.union([z.object({ status: z.literal("queued") }).strict(), failureSchema]);
const publishedSchema = z.object({ status: z.literal("published"), publicationRevision: z.literal(1),
  published: z.number().int().min(0).max(64), qcFailed: z.number().int().min(0).max(64) }).strict();

export type EmbryoSplitClaim = z.infer<typeof claimSchema>;
export type EmbryoSplitFragment = z.infer<typeof fragmentSchema>;
export type EmbryoSplitRpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

/** Which landed fragment to read, and what the locked manifest says it is. */
export interface EmbryoFragmentRef {
  sessionId: string;
  sequence: number;
  ordinal: number;
  byteCount: number;
  sha256: string;
  /** The store's landed identity for exactly this fragment, as the read
   * door issued it under the live claim. Opaque to the worker. */
  landed: unknown;
}

/** Thrown by a reader when the store holds something other than the landed
 * fragment (absent, fenced, or different bytes): terminal, never retried. */
export class EmbryoSplitFragmentMismatch extends Error {
  constructor() { super("embryo_split_fragment_mismatch"); this.name = "EmbryoSplitFragmentMismatch"; }
}

/**
 * The one seam to the fragment store: (session, sequence, ordinal) plus its
 * SQL-issued landed identity, to the exact landed bytes. An implementation
 * may verify size and digest itself; the worker verifies both again
 * regardless. `EmbryoSplitFragmentMismatch`, or wrong bytes, is a terminal
 * `chunk` failure; any other rejection is a transient read failure.
 */
export type EmbryoFragmentReader = (fragment: EmbryoFragmentRef, signal: AbortSignal) => Promise<Uint8Array>;

/**
 * The one seam to the canonical-source store: write `bytes` create-only to the
 * exact receipt `reserve_embryo_canonical_part_v1` issued, read them back and
 * land them through `acknowledge`, which carries the fragment store's ACK call
 * to the canonical-part ACK under the live claim. Resolves with the landed
 * identity only after SQL accepted it. Any rejection is a transient failure of
 * this attempt; the next attempt reserves new keys.
 */
export type EmbryoCanonicalPartWriter = (part: {
  target: EmbryoR2WriteTarget; bytes: Uint8Array; acknowledge: EmbryoFragmentRpc;
}, signal: AbortSignal) => Promise<EmbryoStoredFragment>;

export type EmbryoSplitResult =
  | { status: "idle" }
  | { status: "published"; jobId: string; passed: number; failed: number }
  | { status: "failure_pending"; jobId: string; code: string }
  | { status: "requeued"; jobId: string };

export class EmbryoSplitWorkerError extends Error {
  constructor(readonly code: "unavailable" | "integrity_mismatch" | "aborted") {
    super(code); this.name = "EmbryoSplitWorkerError";
  }
}
const fail = (code: EmbryoSplitWorkerError["code"]): never => { throw new EmbryoSplitWorkerError(code); };

/** A stop the database already recorded: the attempt failed, or was requeued. */
class Stop extends Error {
  constructor(readonly result: EmbryoSplitResult) { super("stop"); }
}

/** Service-role RPC through the admin client, bounded to 30 seconds a call. */
export function adminSplitRpc(): EmbryoSplitRpc {
  const admin = createAdminClient();
  const call = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
  return async (name, args, signal) => {
    const timeout = AbortSignal.timeout(30_000);
    const result = await call(name, args).abortSignal(AbortSignal.any([signal, timeout]));
    if (result.error) fail("unavailable");
    return result.data;
  };
}

export async function runNextEmbryoSplit(options: {
  readFragment: EmbryoFragmentReader; writeCanonicalPart: EmbryoCanonicalPartWriter;
  signal?: AbortSignal; rpc?: EmbryoSplitRpc; workerId?: string; batchSize?: number; renewEveryMs?: number;
}): Promise<EmbryoSplitResult> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const batchSize = options.batchSize ?? 2000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5000) fail("unavailable");
  let leaseTimer: ReturnType<typeof setTimeout> | undefined;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  let stopped = false;
  const active = () => { if (signal.aborted) fail("aborted"); };
  try {
    active();
    const rpc = options.rpc ?? adminSplitRpc();
    const { readFragment, writeCanonicalPart } = options;
    const call = async (name: string, args: Record<string, unknown>) => { active(); const data = await rpc(name, args, signal); active(); return data; };
    const token = createHash("sha256").update(randomBytes(32)).digest("hex");
    const raw = await call("claim_embryo_split_job_v1", { p_claim_token_hash: token,
      p_worker_id: options.workerId ?? "embryo-split-worker" });
    if (raw === null) return { status: "idle" };
    const claim = claimSchema.parse(raw);
    const args = { p_job_id: claim.jobId, p_attempt: claim.attempt, p_claim_token_hash: token };
    const byOrdinal = Array.from({ length: claim.embryoCount }, (_, ordinal) =>
      claim.fragments.filter((fragment) => fragment.ordinal === ordinal).sort((a, b) => a.sequence - b.sequence));
    if (byOrdinal.some((fragments) => fragments.length === 0)
      || byOrdinal.flat().length !== claim.fragments.length) fail("integrity_mismatch");

    // A stop the database recorded ends the run with that result.
    const stopIfFailed = (data: unknown) => {
      const failed = failureSchema.safeParse(data);
      if (failed.success) throw new Stop({ status: "failure_pending", jobId: claim.jobId, code: failed.data.failureCode });
      return data;
    };
    const remainingOf = (current: { claimExpiresAt: string; deadline: string }) => {
      const remaining = Math.min(Date.parse(current.claimExpiresAt), Date.parse(current.deadline)) - Date.now();
      if (remaining <= 0) fail("unavailable");
      return remaining;
    };
    const validate = (data: unknown) => {
      const current = leaseSchema.parse(stopIfFailed(data));
      if (current.jobId !== claim.jobId || current.attempt !== claim.attempt || current.deadline !== claim.deadline
        || current.sessionId !== claim.sessionId || current.manifestSha256 !== claim.manifestSha256) fail("integrity_mismatch");
      return remainingOf(current);
    };
    const armLease = (remaining: number) => {
      if (leaseTimer) clearTimeout(leaseTimer);
      leaseTimer = setTimeout(() => controller.abort(), remaining); leaseTimer.unref();
    };
    armLease(remainingOf(claim));
    const scheduleRenewal = () => {
      if (stopped) return;
      renewTimer = setTimeout(() => {
        renewal = (async () => { armLease(validate(await call("renew_embryo_split_claim_v1", args))); })();
        void renewal.then(() => { renewal = undefined; scheduleRenewal(); }, () => { controller.abort(); });
      }, options.renewEveryMs ?? 120_000); renewTimer.unref();
    };
    scheduleRenewal();
    const check = async () => { armLease(validate(await call("check_embryo_split_claim_v1", args))); };
    // Report a non-QC failure of this attempt; the database decides whether
    // it requeues or ends the attempt, and this run stops either way.
    const report = async (reason: "transient" | "format" | "build" | "chunk"): Promise<never> => {
      const reported = failReportSchema.parse(await call("fail_embryo_split_attempt_v1", { ...args, p_reason: reason }));
      throw new Stop(reported.status === "queued" ? { status: "requeued", jobId: claim.jobId }
        : { status: "failure_pending", jobId: claim.jobId, code: reported.failureCode });
    };

    // Read one fragment under read authority issued for exactly it, and prove
    // its size and SHA-256 against the locked manifest.
    const readVerified = async (ordinal: number, fragment: EmbryoSplitFragment): Promise<Uint8Array> => {
      const authorized = fragmentReadSchema.parse(stopIfFailed(await call("read_embryo_split_fragment_v1", {
        ...args, p_ordinal: ordinal, p_sequence: fragment.sequence })));
      if (authorized.sessionId !== claim.sessionId || authorized.ordinal !== ordinal
        || authorized.sequence !== fragment.sequence || authorized.byteCount !== fragment.byteCount
        || authorized.sha256 !== fragment.sha256) fail("integrity_mismatch");
      let bytes: Uint8Array;
      try {
        bytes = await readFragment({ sessionId: claim.sessionId, sequence: fragment.sequence, ordinal,
          byteCount: fragment.byteCount, sha256: fragment.sha256, landed: authorized.landed }, signal);
      } catch (error) {
        active();
        return await report(error instanceof EmbryoSplitFragmentMismatch ? "chunk" : "transient");
      }
      active();
      if (bytes.byteLength !== fragment.byteCount
        || createHash("sha256").update(bytes).digest("hex") !== fragment.sha256) return await report("chunk");
      return bytes;
    };

    // Copy one verified fragment into its own canonical part: reserve the part
    // under the claim, write it, and land it through the part ACK.
    const writePart = async (ordinal: number, fragment: EmbryoSplitFragment, bytes: Uint8Array) => {
      const target = embryoR2WriteTargetSchema.parse(stopIfFailed(await call("reserve_embryo_canonical_part_v1", {
        ...args, p_ordinal: ordinal, p_sequence: fragment.sequence })));
      if (target.sessionId !== claim.sessionId || target.ordinal !== ordinal || target.sequence !== fragment.sequence
        || target.byteCount !== fragment.byteCount || target.sha256 !== fragment.sha256) fail("integrity_mismatch");
      let refused: unknown = null;
      const acknowledge: EmbryoFragmentRpc = (name, ackArgs) => ({
        abortSignal: async () => {
          if (name !== "ack_embryo_ingest_r2_write_v1") return { data: null, error: "refused" };
          try {
            const data = await call("ack_embryo_canonical_part_v1", { ...args, ...ackArgs });
            if (failureSchema.safeParse(data).success) refused = data;
            return { data, error: null };
          } catch { return { data: null, error: "unavailable" }; }
        },
      });
      let stored: EmbryoStoredFragment;
      try {
        stored = await writeCanonicalPart({ target, bytes, acknowledge }, signal);
      } catch {
        active();
        stopIfFailed(refused);
        return await report("transient");
      }
      active();
      // A failure the ACK recorded stands, whatever the writer made of it.
      stopIfFailed(refused);
      if (!isDeepStrictEqual(stored.receipt, target)) fail("integrity_mismatch");
    };

    let passed = 0, failed = 0;
    for (let ordinal = 0; ordinal < claim.embryoCount; ordinal++) {
      let batch = 0;
      let pending: EmbryoSplitRow[] = [];
      const flush = async () => {
        if (pending.length === 0) return;
        const rows = pending; pending = [];
        const staged = stagedSchema.parse(stopIfFailed(await call("stage_embryo_split_variants_v1", {
          ...args, p_ordinal: ordinal, p_batch: batch, p_rows: rows })));
        if (staged.batch !== batch || staged.rows !== rows.length) fail("integrity_mismatch");
        batch++;
      };
      let measure = emptyMeasure();
      for (const fragment of byOrdinal[ordinal]) {
        const bytes = await readVerified(ordinal, fragment);
        try {
          measure = addMeasures(measure, await analyseEmbryoFragment(bytes, ordinal, claim.build, async (row) => {
            pending.push(row);
            if (pending.length >= batchSize) await flush();
          }));
        } catch (error) {
          if (error instanceof EmbryoTransportError) {
            return await report(error.code === "build_unknown" ? "build" : "format");
          }
          throw error;
        }
      }
      const outcome = embryoOrdinalOutcome(measure);
      if (outcome.outcome === "passed") {
        await flush();
        // The canonical source, one fragment at a time: nothing is held for
        // the whole embryo, and nothing is written for one that failed.
        for (const fragment of byOrdinal[ordinal]) {
          await writePart(ordinal, fragment, await readVerified(ordinal, fragment));
        }
      }
      await check();
      const recorded = recordedSchema.parse(stopIfFailed(await call("finish_embryo_split_ordinal_v1", {
        ...args, p_ordinal: ordinal, p_result: outcome })));
      if (recorded.ordinal !== ordinal || recorded.outcome !== outcome.outcome
        || recorded.remaining !== claim.embryoCount - ordinal - 1) fail("integrity_mismatch");
      if (outcome.outcome === "passed") passed++; else failed++;
    }
    // Settle renewal before the terminal transaction: no background renewal
    // may read the legitimate end of the claim as a lost one.
    stopped = true; if (renewTimer) clearTimeout(renewTimer);
    if (renewal) await renewal;
    const published = publishedSchema.parse(stopIfFailed(await call("publish_embryo_split_v1", args)));
    if (published.published !== passed || published.qcFailed !== failed) fail("integrity_mismatch");
    return { status: "published", jobId: claim.jobId, passed, failed };
  } catch (error) {
    if (error instanceof Stop) return error.result;
    if (signal.aborted) fail("aborted");
    if (error instanceof EmbryoSplitWorkerError) throw error;
    return fail("unavailable");
  } finally {
    stopped = true;
    if (renewTimer) clearTimeout(renewTimer);
    if (leaseTimer) clearTimeout(leaseTimer);
    controller.abort();
  }
}
