import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as equal } from "node:util";
import { z } from "zod";
import { preparedStoredArtifactSchema, preparedArtifactObjectIdentity, type PreparedStoredArtifact } from "./artifact-identity";
import { assertPreparedMetadataBounds } from "./canonical-manifest";
import { canonicalBindingSchema } from "./canonical-schema";
import { compareCanonicalRsidPointers } from "./canonical-rsid-index";
import { validateCanonicalRsidContainerDescriptor } from "./canonical-rsid-containers";
import type { CanonicalRsidMaterializationReceipt } from "./materialize-canonical-rsid";

export class CanonicalRsidReadError extends Error {
  constructor(readonly code: "invalid_request" | "integrity_mismatch" | "unavailable" | "too_large" | "aborted") {
    super(code); this.name = "CanonicalRsidReadError";
  }
}
export function requireRsidIntegrity(condition: unknown): asserts condition {
  if (!condition) throw new CanonicalRsidReadError("integrity_mismatch");
}
export function addRsidArtifactIdentity(identities: Set<string>, artifact: PreparedStoredArtifact) {
  for (const value of [`sequence:${artifact.receipt.sequence}`, `artifact:${artifact.receipt.artifactId}`,
    `object:${preparedArtifactObjectIdentity(artifact)}`, `key:${artifact.receipt.objectKey}`]) {
    requireRsidIntegrity(!identities.has(value)); identities.add(value);
  }
}
const pageSchema = z.object({ version: z.literal("canonical-rsid-container-directory-v1"), state: z.literal("provisional"),
  binding: canonicalBindingSchema, sequence: z.number().int().nonnegative().safe(),
  containers: z.array(z.object({ artifact: preparedStoredArtifactSchema, descriptor: z.unknown() }).strict()).min(1).max(128),
}).strict();

/** Verify the complete selected directory before trusting any index range.
 * The immutable published root and exact member checks supply authority; this
 * decoder proves local metadata consistency, not completeness of unread bytes. */
export function decodeRsidReadDirectory(bytes: Uint8Array, root: CanonicalRsidMaterializationReceipt,
  ref: CanonicalRsidMaterializationReceipt["directories"][number]) {
  requireRsidIntegrity(bytes.length <= 1_048_576 && bytes.length === ref.artifact.receipt.byteCount
    && createHash("sha256").update(bytes).digest("hex") === ref.artifact.receipt.sha256);
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  assertPreparedMetadataBounds(raw, 1_048_576);
  const page = pageSchema.parse(raw);
  requireRsidIntegrity(equal(page.binding, root.binding) && page.sequence === ref.sequence && page.containers.length === ref.containerCount);
  let block = ref.firstBlockSequence, pointers = 0;
  let previous = null as typeof ref.first | null;
  const firstContainer = root.directories.slice(0, ref.sequence).reduce((sum, r) => sum + r.containerCount, 0);
  const identities = new Set<string>();
  for (const metadata of root.directories) addRsidArtifactIdentity(identities, metadata.artifact);
  const containers = page.containers.map((item, index) => {
    const a = item.artifact.receipt;
    requireRsidIntegrity(a.jobId === root.jobId && a.attemptId === root.attemptId
      && a.sequence >= root.firstArtifactSequence && a.sequence < root.nextArtifactSequence
      && a.sequence < ref.artifact.receipt.sequence);
    addRsidArtifactIdentity(identities, item.artifact);
    const descriptor = validateCanonicalRsidContainerDescriptor(item.descriptor, root.binding);
    requireRsidIntegrity(descriptor.sequence === firstContainer + index && descriptor.byteCount === a.byteCount && descriptor.sha256 === a.sha256);
    for (const range of descriptor.blocks) {
      const d = range.descriptor;
      requireRsidIntegrity(d.sequence === block++ && d.first.blockSequence < root.canonicalBlockCount
        && d.last.blockSequence < root.canonicalBlockCount && compareCanonicalRsidPointers(d.first, d.last) <= 0
        && (d.pointerCount !== 1 || equal(d.first, d.last))
        && (!previous || compareCanonicalRsidPointers(previous, d.first) < 0));
      pointers += d.pointerCount; previous = d.last;
    }
    return { artifact: item.artifact, descriptor };
  });
  requireRsidIntegrity(block === ref.lastBlockSequence + 1 && pointers === ref.pointerCount
    && equal(containers[0].descriptor.blocks[0].descriptor.first, ref.first) && equal(previous, ref.last));
  return { ...page, containers };
}
