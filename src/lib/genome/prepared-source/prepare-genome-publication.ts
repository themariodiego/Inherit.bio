import { preparedStoredArtifactSchema, preparedArtifactObjectIdentity } from "./artifact-identity";
import "server-only";
import { createHash } from "node:crypto";
import { validateCanonicalMaterializationReceipt } from "./canonical-manifest";
import { validateCanonicalRsidMaterialization, verifyCanonicalRsidMaterialization } from "./verify-rsid-materialization";
import { verifyCanonicalMaterialization } from "./verify-canonical-materialization";
import { type PreparedArtifactDescriptor, type PreparedStoredArtifact } from "./storage-writer";
import type { CanonicalBinding } from "./canonical-schema";

export type PreparedPublicationSummary = { version: "own-prepared-summary-v1"; sourceBuild: "GRCh37" | "GRCh38";
  parserRevision: string; canonicalRevision: "prepared-canonical-v1"; sourceVariantCount: number; sourceObservedCount: number;
  sourceReferenceCount: number; variantCount: number; observedCallCount: number; usableObservedCount: number;
  attempted: number; unmapped: number; rsidPointerCount: number };
export type PreparedPublicationPayload = { version: "own-prepared-publication-v1"; rootArtifactId: string;
  memberIds: string[]; summary: PreparedPublicationSummary };
export type PreparedGenomeRoot = { version: "prepared-genome-root-v1"; state: "provisional"; binding: CanonicalBinding;
  canonical: PreparedStoredArtifact; rsid: PreparedStoredArtifact; rsidPointerSha256: string; summary: PreparedPublicationSummary };
export class PreparedPublicationError extends Error {
  constructor(readonly code: "invalid_manifest" | "integrity_mismatch" | "unavailable" | "aborted") {
    super(code); this.name = "PreparedPublicationError";
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Fully verify final canonical/index artifacts, then create two bounded root
 * objects and one compact combined root through the actual registered writer.
 * Returns the exact service-only publication payload; does NOT publish or mark
 * the file prepared. The subsequent SQL transaction must recheck current claim,
 * all exact final memberships, original source and final clocks atomically.
 *
 * Inputs come from the actual canonical scan/sort/materialization job. Index
 * verification preserves that provenance; it is not a replacement source parser.
 * check must resolve that job/source/attempt and each registered object using
 * the real current authority. readArtifact/writeArtifact must implement actual
 * authenticated immutable provider I/O, never client-supplied URLs/receipts.
 *
 * Roots are separate <=4MB objects so their combined metadata cannot require a
 * larger single allocation. Final root <=16KiB; SQL payload <=1MiB; membership
 * <=4096. Intermediates are excluded, retained for scratch cleanup. Any failed or
 * uncertain write stays registered/cleanup-owned; no deletion or retry is done.
 * All work shares a 300s ceiling; current claim/job/consent checks may end it sooner.
 */
export async function prepareGenomePublication(input: { canonical: unknown; rsid: unknown;
  expected: { binding: CanonicalBinding; jobId: string; attemptId: string; firstRsidArtifactSequence: number } }, options: {
  readArtifact: (artifact: PreparedStoredArtifact, signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
  writeArtifact: (input: { descriptor: PreparedArtifactDescriptor; bytes: Uint8Array }, signal?: AbortSignal) => Promise<PreparedStoredArtifact>;
  check: (artifact: PreparedStoredArtifact | null, signal: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}) {
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), 300_000); timer.unref();
  const active = () => { if (signal.aborted) throw new PreparedPublicationError("aborted"); };
  const valid = (condition: unknown) => { if (!condition) throw new PreparedPublicationError("integrity_mismatch"); };
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (signal.aborted) { void pending.catch(() => {}); active(); }
    let abort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new PreparedPublicationError("aborted")); signal.addEventListener("abort", abort, { once: true });
    });
    try { const result = await Promise.race([pending, interrupted]); active(); return result; }
    finally { signal.removeEventListener("abort", abort); }
  }
  try {
    active();
    // Own every input before an external callback can mutate caller objects.
    const canonical = validateCanonicalMaterializationReceipt(input.canonical, input.expected);
    const expected = { binding: canonical.binding, jobId: canonical.jobId, attemptId: canonical.attemptId };
    valid(Number.isSafeInteger(input.expected.firstRsidArtifactSequence)
      && input.expected.firstRsidArtifactSequence >= canonical.nextArtifactSequence && input.expected.firstRsidArtifactSequence < 4096);
    const rsidExpected = { ...expected, canonicalBlockCount: canonical.blockCount, canonicalRecordCount: canonical.recordCount,
      firstArtifactSequence: input.expected.firstRsidArtifactSequence };
    const rsid = validateCanonicalRsidMaterialization(input.rsid, rsidExpected);
    valid(rsid.nextArtifactSequence + 3 <= 4096 && canonical.artifactCount + rsid.artifactCount + 3 <= 4096);
    async function check(artifact: PreparedStoredArtifact | null, current = signal) {
      active(); await wait(options.check(artifact ? structuredClone(artifact) : null, current)); active();
    }
    const verifiedCanonical = await verifyCanonicalMaterialization(canonical, expected, {
      signal, readArtifact: options.readArtifact, check: (_root, artifact, current) => check(artifact, current),
    });
    const verifiedRsid = await verifyCanonicalRsidMaterialization(rsid, rsidExpected, {
      signal, readArtifact: options.readArtifact, check: (_root, artifact, current) => check(artifact, current),
    });
    active();
    const members: PreparedStoredArtifact[] = [], identities = new Set<string>();
    function append(artifact: PreparedStoredArtifact) {
      valid(members.length < 4096 && artifact.receipt.jobId === expected.jobId && artifact.receipt.attemptId === expected.attemptId);
      for (const identity of [`artifact:${artifact.receipt.artifactId}`, `object:${preparedArtifactObjectIdentity(artifact)}`,
        `key:${artifact.receipt.objectKey}`, `sequence:${artifact.receipt.sequence}`]) { valid(!identities.has(identity)); identities.add(identity); }
      members.push(artifact);
    }
    for (const artifact of [...verifiedCanonical.artifacts, ...verifiedRsid.artifacts]) append(artifact);
    let sequence = rsid.nextArtifactSequence;
    async function write(bytes: Uint8Array) {
      active(); valid(bytes.length <= 4_000_000 && sequence < 4096);
      await check(null);
      const descriptor: PreparedArtifactDescriptor = { kind: "container", sequence, byteCount: bytes.length, sha256: sha(bytes) };
      const raw = await wait(options.writeArtifact({ descriptor: { ...descriptor }, bytes }, signal));
      const ack = preparedStoredArtifactSchema.safeParse(raw);
      valid(ack.success); if (!ack.success) throw new PreparedPublicationError("integrity_mismatch");
      const artifact = ack.data;
      valid(artifact.receipt.sequence === sequence && artifact.receipt.byteCount === bytes.length
        && artifact.receipt.sha256 === descriptor.sha256 && sha(bytes) === descriptor.sha256);
      append(artifact); sequence++; await check(artifact); return artifact;
    }
    const canonicalBytes = Buffer.from(JSON.stringify(canonical)), rsidBytes = Buffer.from(JSON.stringify(rsid));
    valid(sha(canonicalBytes) === verifiedCanonical.manifestSha256 && sha(rsidBytes) === verifiedRsid.manifestSha256);
    const canonicalRoot = await write(canonicalBytes), rsidRoot = await write(rsidBytes);
    const s = verifiedCanonical.canonicalSummary, c = verifiedCanonical.counts;
    const summary: PreparedPublicationSummary = { version: "own-prepared-summary-v1", sourceBuild: expected.binding.source.sourceBuild as "GRCh37" | "GRCh38",
      parserRevision: expected.binding.source.parserRevision, canonicalRevision: "prepared-canonical-v1",
      sourceVariantCount: c.sourceVariantCount, sourceObservedCount: c.sourceObservedCount, sourceReferenceCount: c.sourceReferenceCount,
      variantCount: c.normalizedVariantCount, observedCallCount: c.normalizedObservedCount, usableObservedCount: c.usableObservedCount,
      attempted: s.attempted, unmapped: s.unmapped, rsidPointerCount: verifiedRsid.pointerCount };
    const root: PreparedGenomeRoot = { version: "prepared-genome-root-v1", state: "provisional", binding: expected.binding,
      canonical: canonicalRoot, rsid: rsidRoot, rsidPointerSha256: verifiedRsid.pointerSha256, summary };
    const rootBytes = Buffer.from(JSON.stringify(root)); valid(rootBytes.length <= 16_384);
    const rootArtifact = await write(rootBytes);
    members.sort((a, b) => a.receipt.sequence - b.receipt.sequence);
    // Registered rsID scan/sort scratch may occupy the gap between final phases.
    // Preserve the verified final subset; never promote intervening scratch.
    valid(members.length === verifiedCanonical.artifactCount + verifiedRsid.artifactCount + 3);
    const payload: PreparedPublicationPayload = { version: "own-prepared-publication-v1", rootArtifactId: rootArtifact.receipt.artifactId,
      memberIds: members.map(artifact => artifact.receipt.artifactId).sort(), summary };
    valid(Buffer.byteLength(JSON.stringify(payload)) <= 1_048_576);
    await check(null); active();
    return { version: "prepared-genome-publication-input-v1" as const, state: "provisional" as const,
      rootArtifact, canonicalRoot, rsidRoot, members, payload, nextArtifactSequence: sequence };
  } catch (error) {
    if (signal.aborted) throw new PreparedPublicationError("aborted");
    if (error instanceof PreparedPublicationError) throw error;
    throw new PreparedPublicationError("unavailable");
  } finally { clearTimeout(timer); controller.abort(); }
}
