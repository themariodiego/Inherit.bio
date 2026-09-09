import "server-only";
import { z } from "zod";
import { PREPARED_CONTAINER_MAX_BYTES } from "./containers";
import { preparedObjectKeySchema } from "./storage-common";

const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const fields = {
  artifactId: uuid, jobId: uuid, attemptId: uuid,
  sequence: z.number().int().min(0).max(4095), objectKey: preparedObjectKeySchema,
  byteCount: z.number().int().min(1).max(PREPARED_CONTAINER_MAX_BYTES), sha256: hash,
  writeExpiresAt: z.iso.datetime({ offset: true }),
};
export const preparedSupabaseReceiptSchema = z.object({
  version: z.literal("own-preparation-artifact-v1"), bucket: z.literal("genomes"), ...fields,
}).strict();
export const preparedR2ReceiptSchema = z.object({
  version: z.literal("own-preparation-artifact-v2"), provider: z.literal("r2"),
  bucket: z.string().regex(/^inherit-prepared-[a-z0-9-]{1,40}$/), ...fields,
}).strict();
export const preparedArtifactReceiptSchema = z.discriminatedUnion("version", [
  preparedSupabaseReceiptSchema, preparedR2ReceiptSchema,
]);
export const preparedStoredArtifactSchema = z.union([
  z.object({ receipt: preparedSupabaseReceiptSchema, storageObjectId: uuid }).strict(),
  z.object({ receipt: preparedR2ReceiptSchema,
    providerVersion: z.string().regex(/^[0-9a-f]{32}$/), etag: z.string().regex(/^[0-9a-f]{32}$/),
  }).strict(),
]);
export type PreparedArtifactReceipt = z.infer<typeof preparedArtifactReceiptSchema>;
export type PreparedStoredArtifact = z.infer<typeof preparedStoredArtifactSchema>;
/** Provider versions are never represented as invented Supabase object UUIDs. */
export function preparedArtifactObjectIdentity(artifact: PreparedStoredArtifact): string {
  return "storageObjectId" in artifact ? `supabase:${artifact.storageObjectId}`
    : `r2:${artifact.receipt.bucket}:${artifact.receipt.objectKey}:${artifact.providerVersion}`;
}
