import { z } from "zod";
import type { FileKind } from "../genome/types";

export const SUBJECT_UPLOAD_FORMATS = ["consumer-array-text-v1", "consumer-array-text-v2",
  "consumer-array-text-v3", "consumer-array-text-v4", "VCF", "VCF.GZ", "gVCF"] as const;
export type SubjectUploadFormat = (typeof SUBJECT_UPLOAD_FORMATS)[number];
const uuid = z.uuid().regex(/^[0-9a-f-]+$/);
const declaration = { sizeBytes: z.number().int().positive().safe(), sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable() };
export const uploadSessionBody = z.union([
  z.object({ subjectId: z.union([uuid, z.literal("me")]), declaredFormat: z.enum(SUBJECT_UPLOAD_FORMATS), ...declaration }).strict(),
  z.object({ cohortId: uuid, declaredFormat: z.enum(["VCF", "VCF.GZ", "gVCF", "pgt_table"]), ...declaration }).strict(),
]);
export const directUploadReceipt = z.object({
  transport: z.literal("direct-storage"), uploadId: uuid, bucket: z.literal("genomes"), stagingKey: uuid,
  uploadToken: z.string().min(1), authorizationHeader: z.literal("Bearer {uploadToken}"),
  maximumBytes: z.number().int().positive().safe(), expiresAt: z.iso.datetime({ offset: true }),
}).strict();
const byteCeiling = z.number().int().positive().safe();
/** The deployment's own-upload ceilings and this account's reserved total, as
 * `public.own_upload_limits_v1` returns them. Ceilings are deployment capacity,
 * never a browser assertion; nothing here is a promise about a future limit. */
export const ownUploadLimitsSchema = z.object({
  maximumArrayBytes: byteCeiling, maximumVcfBytes: byteCeiling, maximumAccountBytes: byteCeiling,
  maximumActiveUploads: z.number().int().positive().safe(),
  reservedBytes: z.number().int().nonnegative().safe(), activeUploads: z.number().int().nonnegative().safe(),
}).strict();
export type OwnUploadLimits = z.infer<typeof ownUploadLimitsSchema>;

/** The one ceiling that applies to a declared format, split exactly as
 * `private.issue_own_storage_upload_v1` splits it. Issuance stores this same
 * number as the session's `maximum_decoded_bytes`, so a compressed source is
 * measured against it twice: as stored bytes now, as decompressed bytes later. */
export function uploadCeilingBytes(format: SubjectUploadFormat, limits: OwnUploadLimits): number {
  return format.startsWith("consumer-array-text-v") ? limits.maximumArrayBytes : limits.maximumVcfBytes;
}

/** What this account could still add, never below zero. */
export function remainingAccountBytes(limits: OwnUploadLimits): number {
  return Math.max(0, limits.maximumAccountBytes - limits.reservedBytes);
}

export const subjectFinalizationReceipt = z.object({ fileId: uuid, status: z.literal("finalized_ready_for_processing"),
  analysisState: z.literal("ready_for_processing"),
  next: z.object({ routeId: z.literal("api.file-process"), operation: z.literal("process") }).strict(),
}).strict();
export const subjectNormalizationReceipt = z.object({ fileId: uuid,
  status: z.literal("normalization_complete"), analysisState: z.literal("not_generated"),
}).strict();
export const subjectSynchronousReportReceipt = z.object({ fileId: uuid,
  status: z.enum(["processed", "already_processed"]), analysisState: z.literal("active"),
}).strict();
export const subjectQueuedPreparationReceipt = z.object({ fileId: uuid, jobId: uuid,
  status: z.literal("preparing"), analysisState: z.literal("not_generated") }).strict();
export const subjectProcessingReceipt = z.union([subjectNormalizationReceipt, subjectSynchronousReportReceipt, subjectQueuedPreparationReceipt]);
/** Acknowledges preparation only; some reports or their notice may already exist. */
export const subjectReportGenerationFailure = z.object({
  error: z.literal("report_generation_unavailable"), fileId: uuid,
}).strict();

/** Parser identities stay internal; neither filenames nor vendor labels select authority. */
export function declaredSubjectFormat(kind: FileKind, compressed: boolean): SubjectUploadFormat | null {
  switch (kind) {
    case "array_23andme": return "consumer-array-text-v1";
    case "array_ancestry": return "consumer-array-text-v2";
    case "array_myheritage": return "consumer-array-text-v3";
    case "array_ftdna": return "consumer-array-text-v4";
    case "vcf": return compressed ? "VCF.GZ" : "VCF";
    case "gvcf": return "gVCF";
    default: return null;
  }
}
