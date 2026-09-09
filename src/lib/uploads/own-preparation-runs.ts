import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { preparedArtifactObjectIdentity, type PreparedStoredArtifact } from "../genome/prepared-source/artifact-identity";
import { preparationActive, preparationFail, preparationJson, preparationSha256,
  ownPreparationStoredArtifactSchema, type OwnPreparationArtifacts } from "./own-preparation-artifacts";

export type PreparationBlock = { sequence: number; compressedBytes: number; compressedSha256: string };
export type PreparationRun<D extends PreparationBlock> = { sequence: number; blocks: D[] };
const integer = z.number().int().nonnegative().safe();
const locationSchema = z.object({ sequence: integer, container: integer.max(4095), offset: integer.max(8_388_608), length: integer.positive().max(8_388_608) }).strict();
const envelopeSchema = z.object({ version: z.literal("own-preparation-run-v1"), kind: z.enum(["source", "canonical", "rsid"]),
  run: z.unknown(), containers: z.array(ownPreparationStoredArtifactSchema).min(1).max(4096),
  locations: z.array(locationSchema).min(1).max(32_000) }).strict();
export type PreparationRunHandle = { version: "own-preparation-run-handle-v1"; kind: "source" | "canonical" | "rsid";
  artifact: PreparedStoredArtifact; sequence: number; count: number; firstBlockSequence: number; blockCount: number };

/** Temporary sorted runs are packed before provider writes. The durable run
 * envelope binds every block range to its full immutable container receipt.
 * Only one run's metadata and <=1MiB target buffer (<=8MiB singleton) are built
 * at a time. writeBlock ACK means buffered acceptance; writeRun flushes first.
 * These scratch envelopes are not final source manifests or capabilities. */
export function createOwnPreparationRunStore<D extends PreparationBlock, R extends PreparationRun<D>>(options: {
  kind: PreparationRunHandle["kind"]; artifacts: OwnPreparationArtifacts; signal: AbortSignal;
  parseBlock: (raw: unknown) => D; parseRun: (raw: unknown) => R; count: (run: R) => number;
  firstBlockSequence?: number;
}) {
  const { artifacts, signal } = options;
  let nextBlock = options.firstBlockSequence ?? 0, failed = false, busy = false;
  let descriptors: D[] = [], containers: PreparedStoredArtifact[] = [];
  let locations: z.infer<typeof locationSchema>[] = [];
  let parts: { descriptor: D; bytes: Uint8Array }[] = [], buffered = 0;
  const handles: PreparationRunHandle[] = [];
  async function flush() {
    if (!parts.length) return;
    const bytes = new Uint8Array(buffered); let offset = 0;
    for (const part of parts) { bytes.set(part.bytes, offset); offset += part.bytes.length; }
    const artifact = await artifacts.persist(bytes), index = containers.length; containers.push(artifact); offset = 0;
    for (const part of parts) {
      locations.push({ sequence: part.descriptor.sequence, container: index, offset, length: part.bytes.length }); offset += part.bytes.length;
    }
    parts = []; buffered = 0;
  }
  async function guarded<T>(fn: () => Promise<T>) {
    preparationActive(signal); if (failed || busy) preparationFail("invalid_state"); busy = true;
    try { return await fn(); } catch (error) { failed = true; throw error; } finally { busy = false; }
  }
  async function writeBlock(input: { descriptor: D; compressed: Uint8Array }) {
    return guarded(async () => {
      const descriptor = options.parseBlock(input.descriptor);
      if (!(input.compressed instanceof Uint8Array) || input.compressed.length > 8_388_608 || descriptors.length >= 32_000
        || descriptor.sequence !== nextBlock || descriptor.compressedBytes !== input.compressed.length
        || descriptor.compressedSha256 !== preparationSha256(input.compressed)) preparationFail("integrity_mismatch");
      const bytes = Uint8Array.from(input.compressed); // Own before any flush await.
      if (parts.length && (parts.length >= 128 || buffered + bytes.length > 1_048_576)) await flush();
      parts.push({ descriptor, bytes }); buffered += bytes.length; descriptors.push(descriptor); nextBlock++;
      if (buffered >= 1_048_576 || parts.length >= 128) await flush();
      preparationActive(signal); return structuredClone(descriptor);
    });
  }
  async function writeRun(raw: R) {
    return guarded(async () => {
      const run = options.parseRun(raw);
      if (!descriptors.length || !isDeepStrictEqual(run.blocks, descriptors) || handles.length >= 4096
        || (handles.length && run.sequence <= handles.at(-1)!.sequence)) preparationFail("integrity_mismatch");
      await flush();
      const envelope = { version: "own-preparation-run-v1", kind: options.kind, run, containers, locations };
      const artifact = await artifacts.persist(preparationJson(envelope));
      const handle: PreparationRunHandle = { version: "own-preparation-run-handle-v1", kind: options.kind, artifact,
        sequence: run.sequence, count: options.count(run), firstBlockSequence: run.blocks[0].sequence, blockCount: run.blocks.length };
      handles.push(handle); preparationJson(handles); // Bounded checkpoint metadata.
      descriptors = []; containers = []; locations = [];
      return structuredClone(run);
    });
  }
  /** At most eight verified run envelopes and one container cache per input.
   * readBlock is consumed serially by existing merge engines; no all-file map. */
  async function reader(input: readonly PreparationRunHandle[]) {
    if (!Array.isArray(input) || !input.length || input.length > 8) preparationFail("too_large");
    const states: { run: R; locations: Map<number, z.infer<typeof locationSchema>>; containers: PreparedStoredArtifact[];
      cacheIndex: number; cache: Uint8Array | null }[] = [];
    const identities = new Set<string>();
    for (const rawHandle of input) {
      preparationJson(rawHandle, 4096);
      const handle = structuredClone(rawHandle);
      if (handle.version !== "own-preparation-run-handle-v1" || handle.kind !== options.kind) preparationFail("integrity_mismatch");
      const bytes = await artifacts.read(handle.artifact);
      if (bytes.length > 4_000_000) preparationFail("too_large");
      let raw: unknown;
      try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { preparationFail("integrity_mismatch"); }
      preparationJson(raw);
      const envelope = envelopeSchema.parse(raw), run = options.parseRun(envelope.run);
      if (envelope.kind !== options.kind || run.sequence !== handle.sequence || options.count(run) !== handle.count
        || run.blocks.length !== handle.blockCount || run.blocks[0].sequence !== handle.firstBlockSequence
        || envelope.locations.length !== run.blocks.length) preparationFail("integrity_mismatch");
      const map = new Map<number, z.infer<typeof locationSchema>>(); let container = 0, end = 0;
      for (let i = 0; i < run.blocks.length; i++) {
        const block = run.blocks[i], location = envelope.locations[i];
        if (location.container === container + 1 && end === envelope.containers[container].receipt.byteCount) { container++; end = 0; }
        if (location.sequence !== block.sequence || location.container !== container || !envelope.containers[container]
          || location.offset !== end || location.length !== block.compressedBytes
          || end + location.length > envelope.containers[container].receipt.byteCount || map.has(block.sequence)
          || (i && block.sequence !== run.blocks[i - 1].sequence + 1)) preparationFail("integrity_mismatch");
        end += location.length; map.set(block.sequence, location);
      }
      if (container !== envelope.containers.length - 1 || end !== envelope.containers[container].receipt.byteCount) preparationFail("integrity_mismatch");
      for (const artifact of [handle.artifact, ...envelope.containers]) {
        // Every object has to remain in this exact live job and attempt.
        if (artifact.receipt.jobId !== handle.artifact.receipt.jobId || artifact.receipt.attemptId !== handle.artifact.receipt.attemptId) preparationFail("integrity_mismatch");
        for (const id of [`id:${artifact.receipt.artifactId}`, `key:${artifact.receipt.objectKey}`, `object:${preparedArtifactObjectIdentity(artifact)}`, `sequence:${artifact.receipt.sequence}`]) {
          if (identities.has(id)) preparationFail("integrity_mismatch"); identities.add(id);
        }
      }
      states.push({ run, locations: map, containers: envelope.containers, cacheIndex: -1, cache: null });
    }
    return { runs: states.map(s => s.run), readBlock: async (raw: D, current = signal) => {
      preparationActive(current); const descriptor = options.parseBlock(raw);
      const state = states.find(s => s.locations.has(descriptor.sequence));
      if (!state) return preparationFail("integrity_mismatch");
      const offset = descriptor.sequence - state.run.blocks[0].sequence;
      if (!isDeepStrictEqual(state.run.blocks[offset], descriptor)) preparationFail("integrity_mismatch");
      const location = state.locations.get(descriptor.sequence)!;
      if (state.cacheIndex !== location.container) {
        state.cache = null; state.cache = await artifacts.read(state.containers[location.container], current); state.cacheIndex = location.container;
      }
      const bytes = state.cache!.subarray(location.offset, location.offset + location.length);
      if (preparationSha256(bytes) !== descriptor.compressedSha256) preparationFail("integrity_mismatch");
      return (async function* () { yield bytes; })();
    } };
  }
  return { sink: { writeBlock, writeRun }, reader, get handles() { return structuredClone(handles); },
    get nextBlockSequence() { return nextBlock; } };
}
