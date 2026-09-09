import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { streamVcf } from "../genome/parsers/vcf";
import { encodePreparedBlock, PreparedBlockError } from "../genome/prepared-source/codec";
import { preparedSourceBindingSchema, preparedBlockDescriptorSchema, type PreparedEvent, type PreparedBlockDescriptor } from "../genome/prepared-source/schema";
import { createPreparedRuns, type PreparedRunReceipt } from "../genome/prepared-source/runs";
import { mergePreparedRuns, type PreparedMergeSummary } from "../genome/prepared-source/merge";
import { canonicalizePreparedEvents } from "../genome/prepared-source/canonical";
import { canonicalBindingSchema, type CanonicalRecord } from "../genome/prepared-source/canonical-schema";
import { encodeCanonicalBlock, canonicalBlockDescriptorSchema, CanonicalBlockError, type CanonicalBlockDescriptor } from "../genome/prepared-source/canonical-codec";
import { createCanonicalRuns, type CanonicalRunReceipt } from "../genome/prepared-source/canonical-runs";
import { mergeCanonicalRuns, type CanonicalMergeSummary } from "../genome/prepared-source/canonical-merge";
import { materializeCanonicalMerge } from "../genome/prepared-source/materialize-canonical";
import { decodeCanonicalContainerDirectory } from "../genome/prepared-source/canonical-manifest";
import { verifyCanonicalContainerBytes } from "../genome/prepared-source/canonical-containers";
import { createCanonicalRsidRuns, mergeCanonicalRsidRuns, encodeCanonicalRsidBlock, canonicalRsidBlockDescriptorSchema,
  type CanonicalRsidPointer, type CanonicalRsidBlockDescriptor, type CanonicalRsidRunReceipt, type CanonicalRsidMergeSummary } from "../genome/prepared-source/canonical-rsid-index";
import { materializeCanonicalRsidMerge } from "../genome/prepared-source/materialize-canonical-rsid";
import { prepareGenomePublication } from "../genome/prepared-source/prepare-genome-publication";
import { scanOwnPreparationSource, readOwnPreparationLines, type OwnPreparationSourceOptions, type OwnPreparationScan, ownPreparationScanSchema } from "./own-preparation-source";
import { createOwnPreparationArtifacts, preparationRecordBytes, preparationActive, preparationFail, preparationJson, preparationWait,
  type OwnPreparationArtifactIO } from "./own-preparation-artifacts";
import { createOwnPreparationRunStore, type PreparationBlock, type PreparationRun, type PreparationRunHandle } from "./own-preparation-runs";

const integer = z.number().int().nonnegative().safe();
const preparedRunSchema = z.object({ version: z.literal("prepared-run-v1"), state: z.literal("provisional"),
  source: preparedSourceBindingSchema, sequence: integer, eventCount: integer.positive(), blocks: z.array(preparedBlockDescriptorSchema).min(1).max(32_000) }).strict();
const canonicalRunSchema = z.object({ version: z.literal("canonical-run-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer, recordCount: integer.positive(), blocks: z.array(canonicalBlockDescriptorSchema).min(1).max(32_000) }).strict();
const rsidRunSchema = z.object({ version: z.literal("canonical-rsid-run-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: integer, pointerCount: integer.positive(), blocks: z.array(canonicalRsidBlockDescriptorSchema).min(1).max(32_000) }).strict();
export type OwnPreparationCheckpoint = {
  version: "own-preparation-checkpoint-v1"; state: "provisional";
  phase: "source-scan" | "source-runs" | "source-merge" | "canonical-runs" | "canonical-merge" | "canonical-materialization" | "rsid-runs" | "rsid-merge" | "publication-preflight";
  sourceScan: OwnPreparationScan; generation: number; completedInputRuns: number; inputs: PreparationRunHandle[]; outputs: PreparationRunHandle[];
  nextArtifactSequence: number; terminal: unknown; resume: OwnPreparationResumeState;
};
export type OwnPreparationResumeState = {
  scan: OwnPreparationScan;
  parserReceipt: Awaited<ReturnType<typeof createPreparedRuns>> | null;
  canonicalRunsReceipt: Awaited<ReturnType<typeof createCanonicalRuns>> | null;
  canonical: Awaited<ReturnType<typeof materializeCanonicalMerge>> | null;
  scanReceipt: Awaited<ReturnType<typeof createCanonicalRsidRuns>> | null;
  rsid: Awaited<ReturnType<typeof materializeCanonicalRsidMerge>> | null;
  sourceRuns: PreparationRunHandle[]; canonicalRuns: PreparationRunHandle[]; rsidRuns: PreparationRunHandle[];
};
export type OwnPreparationPipelineOptions = OwnPreparationArtifactIO & {
  original: OwnPreparationSourceOptions;
  /** Must persist with a current job/phase revision CAS and return exact bytes.
   * Never treat a partially produced generation as complete source evidence. */
  checkpoint: (checkpoint: OwnPreparationCheckpoint, signal: AbortSignal) => Promise<OwnPreparationCheckpoint>;
  liftover?: { chainBytes: Uint8Array; sha256: string };
  maximumUnmappedFraction: number;
  /** Loaded only through the current same-attempt checkpoint RPC, never request input. */
  resume?: OwnPreparationCheckpoint;
};

function nextBlock(runs: PreparationRunHandle[], checkpoint?: OwnPreparationCheckpoint): number {
  const values = [...runs, ...(checkpoint?.inputs ?? []), ...(checkpoint?.outputs ?? [])];
  if (values.length > 12_288) preparationFail("too_large");
  return Math.max(0, ...values.map(r => r.firstBlockSequence + r.blockCount));
}

/** Bounded external ordering and actual publication preflight. No DB call map,
 * provider-specific transport, analysis, lifecycle mutation or SQL publication.
 * This function is worker work, not a long-lived browser request. The caller
 * owns a finite claim deadline, current checks, checkpoints and cleanup.
 *
 * Initial sort windows <=32k records/8MiB; merge fan-in <=8; scratch blocks are
 * packed into <=1MiB targets/8MiB hard max. A run envelope <=4MB, checkpoint <=4MB,
 * and existing artifact/run ceilings fail closed. These are bounds, NOT an
 * assertion of ordinary-WGS capacity or throughput. A failure never restarts or
 * retries writes. Resume/adoption requires the authoritative worker journal.
 */
export async function runOwnPreparationPipeline(options: OwnPreparationPipelineOptions) {
  const signal = options.signal, artifacts = createOwnPreparationArtifacts(options);
  preparationActive(signal);
  if (options.original.signal !== signal) preparationFail("invalid_state");
  let saved: OwnPreparationCheckpoint | undefined;
  if (options.resume) {
    preparationJson(options.resume); saved = structuredClone(options.resume);
    const checkedScan = ownPreparationScanSchema.parse(saved.sourceScan);
    if (saved.version !== "own-preparation-checkpoint-v1" || saved.state !== "provisional"
      || !isDeepStrictEqual(checkedScan.source, options.original.source)
      || saved.nextArtifactSequence !== options.firstArtifactSequence
      || !isDeepStrictEqual(saved.resume?.scan, checkedScan)) preparationFail("integrity_mismatch");
    await preparationWait(options.check(null, signal), signal);
  }
  const scan = saved ? ownPreparationScanSchema.parse(saved.sourceScan) : await scanOwnPreparationSource(options.original);
  const state: OwnPreparationResumeState = saved ? structuredClone(saved.resume) : {
    scan, parserReceipt: null, canonicalRunsReceipt: null, canonical: null, scanReceipt: null, rsid: null,
    sourceRuns: [], canonicalRuns: [], rsidRuns: [],
  };
  const checkpointGenerations = new Map<string, number>();
  if (saved) checkpointGenerations.set(saved.phase, saved.generation);
  async function checkpoint(phase: OwnPreparationCheckpoint["phase"], terminal: unknown,
    inputs: PreparationRunHandle[] = [], outputs: PreparationRunHandle[] = [], generation = (checkpointGenerations.get(phase) ?? -1) + 1, completedInputRuns = inputs.length) {
    const expected: OwnPreparationCheckpoint = { version: "own-preparation-checkpoint-v1", state: "provisional", phase,
      sourceScan: scan, generation, completedInputRuns, inputs, outputs, terminal, resume: state, nextArtifactSequence: artifacts.nextSequence };
    preparationJson(expected);
    await preparationWait(options.check(null, signal), signal);
    const ack = await preparationWait(options.checkpoint(structuredClone(expected), signal), signal);
    preparationJson(ack);
    if (!isDeepStrictEqual(expected, ack)) preparationFail("integrity_mismatch");
    checkpointGenerations.set(phase, generation);
  }
  if (!saved) await checkpoint("source-scan", scan);
  const source = preparedSourceBindingSchema.parse({ fileId: scan.source.fileId, subjectId: scan.source.subjectId,
    sourceRevision: scan.source.sourceRevision, rawSha256: scan.rawSha256, decodedSha256: scan.decodedSha256,
    sourceBuild: scan.build, parserRevision: "vcf-stream-v1" });
  const binding = canonicalBindingSchema.parse({ version: "prepared-canonical-v1", source, targetBuild: "GRCh38",
    liftoverSha256: source.sourceBuild === "GRCh37" ? options.liftover?.sha256 : null });
  const sourceStore = createOwnPreparationRunStore<PreparedBlockDescriptor, PreparedRunReceipt>({
    kind: "source", artifacts, signal, firstBlockSequence: nextBlock(state.sourceRuns, saved?.phase === "source-merge" ? saved : undefined), parseBlock: raw => preparedBlockDescriptorSchema.parse(raw),
    parseRun: raw => { preparationJson(raw); const r = preparedRunSchema.parse(raw);
      if (!isDeepStrictEqual(r.source, source)) preparationFail("integrity_mismatch"); return r; }, count: r => r.eventCount,
  });
  if (!state.parserReceipt) {
    state.parserReceipt = await createPreparedRuns(streamVcf(readOwnPreparationLines(options.original, scan)), { source, signal, sink: sourceStore.sink });
    state.sourceRuns = sourceStore.handles;
    await checkpoint("source-runs", state.parserReceipt, [], state.sourceRuns);
  }
  const parserReceipt = state.parserReceipt;

  async function reduce<D extends PreparationBlock, R extends PreparationRun<D>, E, S>(config: {
    phase: OwnPreparationCheckpoint["phase"];
    store: ReturnType<typeof createOwnPreparationRunStore<D, R>>;
    merge: (runs: R[], readBlock: (descriptor: D, signal?: AbortSignal) => Promise<AsyncIterable<Uint8Array>>) => AsyncIterable<E | S>;
    isSummary: (value: E | S) => value is S;
    encode: (events: E[], sequence: number) => Promise<{ descriptor: D; compressed: Uint8Array }>;
    receipt: (sequence: number, count: number, blocks: D[]) => R;
    summaryCount: (summary: S) => number;
    terminal: unknown; initial: PreparationRunHandle[];
  }) {
    const progress = saved?.phase === config.phase && saved.completedInputRuns <= saved.inputs.length ? saved : undefined;
    let current = progress?.inputs.length ? progress.inputs : config.initial;
    let generation = progress ? progress.generation - 1 : 0;
    let pendingOutput = progress?.outputs ?? [], start = progress?.completedInputRuns ?? 0;
    // A final completed source-merge checkpoint repeats its <=8 input refs;
    // there is no generation work to replay in that case.
    if (current.length <= 8) return current;
    let nextRun = Math.max(-1, ...current.map(r => r.sequence), ...pendingOutput.map(r => r.sequence)) + 1;
    while (current.length > 8) {
      const output: PreparationRunHandle[] = pendingOutput; pendingOutput = []; generation++;
      for (let base = start; base < current.length; base += 8) {
        const input = await config.store.reader(current.slice(base, base + 8));
        let events: E[] = [], byteCount = 0, actual = 0, terminal: S | undefined;
        const blocks: D[] = [];
        async function encode(events: E[]): Promise<void> {
          if (!events.length) return;
          let block: { descriptor: D; compressed: Uint8Array };
          try { block = await config.encode(events, config.store.nextBlockSequence); }
          catch (error) {
            if ((error instanceof PreparedBlockError || error instanceof CanonicalBlockError) && error.code === "too_large" && events.length > 1) {
              const middle = Math.floor(events.length / 2); await encode(events.slice(0, middle)); await encode(events.slice(middle)); return;
            }
            throw error;
          }
          await config.store.sink.writeBlock(block); blocks.push(block.descriptor);
          if (blocks.length > 32_000) preparationFail("too_large");
        }
        async function flush() { await encode(events); events = []; byteCount = 0; }
        for await (const event of config.merge(input.runs, input.readBlock)) {
          preparationActive(signal); if (terminal) preparationFail("integrity_mismatch");
          if (config.isSummary(event)) { terminal = event; continue; }
          // Conservative expanded JSON budget; codec avoids doubled long alleles
          // on wire and recursively splits only within this bounded window.
          const size = preparationRecordBytes(event);
          if (events.length && (events.length >= 2000 || byteCount + size > 8_388_608)) await flush();
          events.push(event); byteCount += size; actual++;
        }
        if (!terminal || config.summaryCount(terminal) !== actual
          || actual !== current.slice(base, base + 8).reduce((n, handle) => n + handle.count, 0)) preparationFail("integrity_mismatch");
        await flush();
        const sequence = nextRun++;
        await config.store.sink.writeRun(config.receipt(sequence, actual, blocks));
        output.push(config.store.handles.at(-1)!);
        await checkpoint(config.phase, { sourceTerminal: config.terminal, mergeTerminal: terminal }, current, output,
          generation, Math.min(base + 8, current.length));
      }
      current = output; start = 0;
    }
    return current;
  }
  const sourceRuns = state.canonicalRunsReceipt ? state.sourceRuns : await reduce<PreparedBlockDescriptor, PreparedRunReceipt, PreparedEvent, PreparedMergeSummary>({ phase: "source-merge", store: sourceStore, terminal: parserReceipt, initial: state.sourceRuns,
    merge: (runs, readBlock) => mergePreparedRuns(runs, { source, readBlock, signal }),
    isSummary: (value): value is PreparedMergeSummary => value.type === "merge-summary",
    encode: (events: PreparedEvent[], sequence) => encodePreparedBlock({ source, sequence, events }),
    receipt: (sequence, eventCount, blocks) => ({ version: "prepared-run-v1", state: "provisional", source, sequence, eventCount, blocks }),
    summaryCount: s => s.eventCount,
  });
  state.sourceRuns = sourceRuns;
  const sourceReader = !state.canonicalRunsReceipt ? await sourceStore.reader(sourceRuns) : null;
  let mergeSummary: PreparedMergeSummary | undefined;
  if (sourceReader) for await (const event of mergePreparedRuns(sourceReader.runs, { source, readBlock: sourceReader.readBlock, signal })) {
    if (event.type === "merge-summary") mergeSummary = event;
  }
  if (!state.canonicalRunsReceipt) {
    if (!mergeSummary) preparationFail("integrity_mismatch");
    await checkpoint("source-merge", { parserReceipt, mergeSummary }, sourceRuns, sourceRuns);
  }
  const canonicalStore = createOwnPreparationRunStore<CanonicalBlockDescriptor, CanonicalRunReceipt>({
    kind: "canonical", artifacts, signal, firstBlockSequence: nextBlock(state.canonicalRuns, saved?.phase === "canonical-merge" ? saved : undefined), parseBlock: raw => canonicalBlockDescriptorSchema.parse(raw),
    parseRun: raw => { preparationJson(raw); const r = canonicalRunSchema.parse(raw);
      if (!isDeepStrictEqual(r.binding, binding)) preparationFail("integrity_mismatch"); return r; }, count: r => r.recordCount,
  });
  if (!state.canonicalRunsReceipt) {
    if (!sourceReader || !mergeSummary) preparationFail("integrity_mismatch");
    state.canonicalRunsReceipt = await createCanonicalRuns(canonicalizePreparedEvents(
    mergePreparedRuns(sourceReader.runs, { source, readBlock: sourceReader.readBlock, signal }), {
      source, parserReceipt, expectedMergeSummary: mergeSummary, expectedParserRevision: "vcf-stream-v1",
      liftover: options.liftover, maximumUnmappedFraction: options.maximumUnmappedFraction, signal,
    }), { binding, signal, sink: canonicalStore.sink });
    state.canonicalRuns = canonicalStore.handles;
    await checkpoint("canonical-runs", state.canonicalRunsReceipt, [], state.canonicalRuns);
  }
  const canonicalRunsReceipt = state.canonicalRunsReceipt;
  const canonicalRuns = state.canonical ? state.canonicalRuns : await reduce<CanonicalBlockDescriptor, CanonicalRunReceipt, CanonicalRecord, CanonicalMergeSummary>({ phase: "canonical-merge", store: canonicalStore, terminal: canonicalRunsReceipt, initial: state.canonicalRuns,
    merge: (runs, readBlock) => mergeCanonicalRuns(runs, { binding, readBlock, signal }),
    isSummary: (value): value is Exclude<typeof value, CanonicalRecord> => value.type === "canonical-merge-summary",
    encode: (records: CanonicalRecord[], sequence) => encodeCanonicalBlock({ binding, sequence, records }, { signal }),
    receipt: (sequence, recordCount, blocks) => ({ version: "canonical-run-v1", state: "provisional", binding, sequence, recordCount, blocks }),
    summaryCount: s => s.recordCount,
  });
  state.canonicalRuns = canonicalRuns;
  if (!state.canonical) {
  const canonicalReader = await canonicalStore.reader(canonicalRuns);
  state.canonical = await materializeCanonicalMerge(mergeCanonicalRuns(canonicalReader.runs, { binding, readBlock: canonicalReader.readBlock, signal }), {
    binding, canonicalSummary: canonicalRunsReceipt.canonicalSummary, jobId: options.jobId, attemptId: options.attemptId,
    firstArtifactSequence: artifacts.nextSequence, writeArtifact: artifacts.write, signal,
  });
  await checkpoint("canonical-materialization", state.canonical);
  }
  const canonical = state.canonical;
  async function* canonicalBlocks() {
    let firstContainer = 0;
    for (const reference of canonical.directories) {
      const directory = decodeCanonicalContainerDirectory(await artifacts.read(reference.artifact), reference, {
        binding, jobId: options.jobId, attemptId: options.attemptId, firstArtifactSequence: canonical.firstArtifactSequence,
        nextArtifactSequence: canonical.nextArtifactSequence, expectedFirstContainerSequence: firstContainer,
        forbiddenArtifacts: [...canonical.directories.map(r => r.artifact), ...canonical.coordinatePages.map(r => r.artifact)],
      });
      firstContainer += directory.containers.length;
      for (const container of directory.containers) {
        const bytes = await artifacts.read(container.artifact); verifyCanonicalContainerBytes(bytes, container.descriptor);
        for (const block of container.descriptor.blocks) yield { descriptor: block.descriptor,
          bytes: (async function* () { yield bytes.subarray(block.offset, block.offset + block.length); })() };
      }
    }
  }
  const rsidStore = createOwnPreparationRunStore<CanonicalRsidBlockDescriptor, CanonicalRsidRunReceipt>({
    kind: "rsid", artifacts, signal, firstBlockSequence: nextBlock(state.rsidRuns, saved?.phase === "rsid-merge" ? saved : undefined), parseBlock: raw => canonicalRsidBlockDescriptorSchema.parse(raw),
    parseRun: raw => { preparationJson(raw); const r = rsidRunSchema.parse(raw);
      if (!isDeepStrictEqual(r.binding, binding)) preparationFail("integrity_mismatch"); return r; }, count: r => r.pointerCount,
  });
  if (!state.scanReceipt) {
    state.scanReceipt = await createCanonicalRsidRuns(canonicalBlocks(), { binding, signal, sink: rsidStore.sink });
    state.rsidRuns = rsidStore.handles;
    await checkpoint("rsid-runs", { scanReceipt: state.scanReceipt, canonical }, [], state.rsidRuns);
  }
  const scanReceipt = state.scanReceipt;
  if (scanReceipt.canonicalBlockCount !== canonical.blockCount || scanReceipt.canonicalRecordCount !== canonical.recordCount) preparationFail("integrity_mismatch");
  const rsidRuns = state.rsid ? state.rsidRuns : await reduce<CanonicalRsidBlockDescriptor, CanonicalRsidRunReceipt, CanonicalRsidPointer, CanonicalRsidMergeSummary>({ phase: "rsid-merge", store: rsidStore, terminal: scanReceipt, initial: state.rsidRuns,
    merge: (runs, readBlock) => mergeCanonicalRsidRuns(runs, { binding, readBlock, signal }),
    isSummary: (value): value is Exclude<typeof value, CanonicalRsidPointer> => "type" in value,
    encode: (pointers: CanonicalRsidPointer[], sequence) => encodeCanonicalRsidBlock({ binding, sequence, pointers }, { signal }),
    receipt: (sequence, pointerCount, blocks) => ({ version: "canonical-rsid-run-v1", state: "provisional", binding, sequence, pointerCount, blocks }),
    summaryCount: s => s.pointerCount,
  });
  state.rsidRuns = rsidRuns;
  const rsidReader = !state.rsid && rsidRuns.length ? await rsidStore.reader(rsidRuns) : null;
  const firstRsidArtifactSequence = state.rsid?.firstArtifactSequence ?? artifacts.nextSequence;
  const rsid = state.rsid ?? await materializeCanonicalRsidMerge(rsidReader ? mergeCanonicalRsidRuns(rsidReader.runs, {
    binding, readBlock: rsidReader.readBlock, signal,
  }) : (async function* () {})(), { binding, expectedScan: scanReceipt, canonicalBlockCount: canonical.blockCount,
    canonicalRecordCount: canonical.recordCount, jobId: options.jobId, attemptId: options.attemptId,
    firstArtifactSequence: firstRsidArtifactSequence, writeArtifact: artifacts.write, signal });
  state.rsid = rsid;
  const publication = await prepareGenomePublication({ canonical, rsid,
    expected: { binding, jobId: options.jobId, attemptId: options.attemptId, firstRsidArtifactSequence } }, {
    readArtifact: options.readArtifact, check: options.check, writeArtifact: artifacts.write, signal,
  });
  await checkpoint("publication-preflight", publication);
  const finalIds = new Set(publication.members.map(m => m.receipt.artifactId));
  const allArtifacts = artifacts.artifacts, scratchArtifacts = allArtifacts.filter(a => !finalIds.has(a.receipt.artifactId));
  if (!saved && scratchArtifacts.length + publication.members.length !== allArtifacts.length) preparationFail("integrity_mismatch");
  await preparationWait(options.check(null, signal), signal);
  return { version: "own-preparation-pipeline-v1" as const, state: "provisional" as const, scan,
    parserReceipt, canonicalRunsReceipt, scanReceipt, publication, scratchArtifacts,
    artifactScope: "this-invocation-only" as const, nextArtifactSequence: artifacts.nextSequence };
}
