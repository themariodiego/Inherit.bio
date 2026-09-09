import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assertPreparedMetadataBounds } from "../genome/prepared-source/canonical-manifest";
import type { PreparedArtifactDescriptor } from "../genome/prepared-source/storage-writer";
import { preparedStoredArtifactSchema, preparedArtifactObjectIdentity, type PreparedStoredArtifact } from "../genome/prepared-source/artifact-identity";
import { readVerifiedPreparedArtifact } from "../genome/prepared-source/verified-artifact-reader";

export type OwnPreparationArtifactIO = {
  jobId: string; attemptId: string; firstArtifactSequence: number; signal: AbortSignal;
  writeArtifact: (input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, signal?: AbortSignal) => Promise<PreparedStoredArtifact>;
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  check: (artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>;
};
export const ownPreparationStoredArtifactSchema = preparedStoredArtifactSchema;
export const preparationSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export class OwnPreparationPipelineError extends Error {
  constructor(readonly code: "integrity_mismatch" | "too_large" | "invalid_state" | "aborted" | "unavailable") {
    super(code); this.name = "OwnPreparationPipelineError";
  }
}
export function preparationFail(code: OwnPreparationPipelineError["code"]): never { throw new OwnPreparationPipelineError(code); }
export function preparationActive(signal: AbortSignal) { if (signal.aborted) preparationFail("aborted"); }
export async function preparationWait<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); preparationFail("aborted"); }
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new OwnPreparationPipelineError("aborted")); signal.addEventListener("abort", abort, { once: true });
  });
  try { const value = await Promise.race([pending, cancelled]); preparationActive(signal); return value; }
  finally { signal.removeEventListener("abort", abort); }
}
export function preparationJson(value: unknown, maximum = 4_000_000): Uint8Array {
  assertPreparedMetadataBounds(value, maximum);
  const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > maximum) preparationFail("too_large"); return bytes;
}
/** Size one already codec-validated event without serializing long allele
 * strings first. Unlike metadata, genetic record strings may exceed128 chars. */
export function preparationRecordBytes(value: unknown, maximum = 8_388_608): number {
  let total = 0;
  const add = (n: number) => { total += n; if (total > maximum) preparationFail("too_large"); };
  function string(text: string) {
    if (text.length > maximum) preparationFail("too_large"); add(2);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) add(2);
      else if (c < 32) add(6);
      else if (c < 128) add(1);
      else if (c < 2048) add(2);
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { add(4); i++; }
      else if (c >= 0xd800 && c <= 0xdfff) add(6);
      else add(3);
    }
  }
  function visit(raw: unknown, depth: number) {
    if (depth > 6) preparationFail("integrity_mismatch");
    if (raw === null) { add(4); return; }
    if (typeof raw === "string") { string(raw); return; }
    if (typeof raw === "boolean") { add(raw ? 4 : 5); return; }
    if (typeof raw === "number" && Number.isFinite(raw)) { add(String(raw).length); return; }
    if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype) preparationFail("integrity_mismatch");
    const keys = Object.keys(raw); if (keys.length > 32) preparationFail("integrity_mismatch");
    add(2); let count = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
      if (!("value" in descriptor)) preparationFail("integrity_mismatch");
      if (count++) add(1); string(key); add(1); visit(descriptor.value, depth + 1);
    }
  }
  visit(value, 0); return total;
}

/** Serial, exact ACK wrapper. This never grants authority, retries, deletes or
 * publishes. The supplied transport owns uncertain writes and journal cleanup.
 * Sequence is taken from the locked job checkpoint, never inferred from files. */
export function createOwnPreparationArtifacts(options: OwnPreparationArtifactIO) {
  z.uuid().parse(options.jobId); z.uuid().parse(options.attemptId);
  let next = z.number().int().min(0).max(4095).parse(options.firstArtifactSequence);
  const all: PreparedStoredArtifact[] = [], identities = new Set<string>();
  let failed = false, busy = false;
  async function write(input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, signal = options.signal): Promise<PreparedStoredArtifact> {
    preparationActive(signal);
    if (failed || busy) preparationFail("invalid_state"); busy = true;
    try {
      if (!(input.bytes instanceof Uint8Array) || input.bytes.length < 1 || input.bytes.length > 8_388_608 || next >= 4096) preparationFail("too_large");
      const bytes = Uint8Array.from(input.bytes), expected: PreparedArtifactDescriptor = {
        kind: "container", sequence: next, byteCount: bytes.length, sha256: preparationSha256(bytes),
      };
      if (!isDeepStrictEqual(input.descriptor, expected)) preparationFail("integrity_mismatch");
      await preparationWait(Promise.resolve(options.check(null, signal)), signal);
      next++; // A possibly admitted write never reuses a sequence on this writer.
      const ack = ownPreparationStoredArtifactSchema.parse(await preparationWait(options.writeArtifact({ descriptor: structuredClone(expected), bytes }, signal), signal));
      if (ack.receipt.jobId !== options.jobId || ack.receipt.attemptId !== options.attemptId
        || ack.receipt.sequence !== expected.sequence || ack.receipt.byteCount !== expected.byteCount || ack.receipt.sha256 !== expected.sha256
        || preparationSha256(bytes) !== expected.sha256) preparationFail("integrity_mismatch");
      for (const key of [`id:${ack.receipt.artifactId}`, `object:${preparedArtifactObjectIdentity(ack)}`, `key:${ack.receipt.objectKey}`]) {
        if (identities.has(key)) preparationFail("integrity_mismatch"); identities.add(key);
      }
      await preparationWait(Promise.resolve(options.check(structuredClone(ack), signal)), signal);
      all.push(ack); return structuredClone(ack);
    } catch (error) {
      failed = true;
      if (error instanceof OwnPreparationPipelineError) throw error;
      preparationFail("unavailable");
    } finally { busy = false; }
  }
  async function persist(bytes: Uint8Array) {
    return write({ bytes, descriptor: { kind: "container", sequence: next, byteCount: bytes.length, sha256: preparationSha256(bytes) } });
  }
  async function read(artifact: PreparedStoredArtifact, signal = options.signal) {
    return readVerifiedPreparedArtifact(artifact, { signal, readArtifact: options.readArtifact, check: options.check });
  }
  return { write, persist, read, get nextSequence() { return next; }, get artifacts() { return structuredClone(all); } };
}
export type OwnPreparationArtifacts = ReturnType<typeof createOwnPreparationArtifacts>;
