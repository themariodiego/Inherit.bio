import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import type { ClaimObjectStore } from "./claim-objects";
import { claimDataKey, openDocumentBytes, sealDocumentBytes } from "./document-envelope";
import { sniffDocumentType } from "./document-sniff";

/**
 * legal-evidence-ingest-v1.finalization for a claim document, between the
 * database's two completion steps: read every fragment the database listed,
 * open each under the claim key, check each against the SHA-256 recorded
 * when it arrived, check the whole against the declared size and SHA-256,
 * sniff its type from its own first bytes, and write one fresh sealed object
 * create-only. Every plaintext buffer is zeroed before this returns.
 *
 * The outcome is 'composed', or a closed failure the database records:
 * 'integrity' (bytes that do not add up), 'type' (the bytes are not the
 * declared type) or 'storage' (a fragment could not be read or the object
 * could not be written).
 */

export const compositionPlan = z.object({
  status: z.literal("compose"),
  documentId: z.uuid(),
  documentKind: z.enum(["future-photo-identity", "future-birth-record"]),
  mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  sizeBytes: z.number().int().min(1).max(20_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  objectKey: z.string().min(1).max(200),
  wrappedDataKey: z.string().regex(/^[0-9a-f]+$/u),
  fragments: z.array(z.object({
    sequence: z.number().int().min(0).max(4),
    objectKey: z.string().min(1).max(200),
    byteCount: z.number().int().min(1).max(4_000_000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }).strict()).min(1).max(5),
}).strict();
export type CompositionPlan = z.infer<typeof compositionPlan>;

export type CompositionOutcome = "composed" | "integrity" | "type" | "storage";

export async function composeClaimDocument(plan: CompositionPlan, store: ClaimObjectStore): Promise<CompositionOutcome> {
  const key = claimDataKey(plan.wrappedDataKey);
  const parts: Buffer[] = [];
  let whole: Buffer | null = null;
  try {
    for (const fragment of plan.fragments) {
      let sealed: Uint8Array;
      try {
        sealed = await store.read(fragment.objectKey);
      } catch {
        return "storage";
      }
      const bytes = openDocumentBytes(key, fragment.objectKey, sealed);
      if (!bytes || bytes.length !== fragment.byteCount
        || crypto.createHash("sha256").update(bytes).digest("hex") !== fragment.sha256) {
        bytes?.fill(0);
        return "integrity";
      }
      parts.push(bytes);
    }
    whole = Buffer.concat(parts);
    if (whole.length !== plan.sizeBytes || crypto.createHash("sha256").update(whole).digest("hex") !== plan.sha256) {
      return "integrity";
    }
    if (sniffDocumentType(whole) !== plan.mediaType) return "type";
    try {
      await store.create(plan.objectKey, sealDocumentBytes(key, plan.objectKey, whole));
    } catch {
      return "storage";
    }
    return "composed";
  } finally {
    key.fill(0);
    for (const part of parts) part.fill(0);
    whole?.fill(0);
  }
}
