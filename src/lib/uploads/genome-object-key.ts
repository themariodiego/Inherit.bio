import { z } from "zod";

const uuidSegment = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const opaqueName = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const legacy = z.uuid().regex(new RegExp(`^${opaqueName}$`));
const current = (extension: string) => z.string().regex(new RegExp(`^(?:${uuidSegment}/){3}original-${opaqueName}\\.${extension}(?![\\s\\S])`));
/** Locator syntax only. Exact database receipts and current authority remain required.
 * Legacy values are never rewritten or inferred from an account prefix. */
export const genomeStagingKeySchema = z.union([legacy, current("part")]);
export const genomeOriginalKeySchema = z.union([legacy, current("(?:vcf|vcf\\.gz|g\\.vcf|txt|tsv)")]);
export const genomeUploadObjectKeySchema = z.union([genomeStagingKeySchema, genomeOriginalKeySchema]);

/** Additional receipt consistency, never permission derived from a folder. */
export function genomeKeyMatchesUpload(key: string, uploadId: string, accountId?: string): boolean {
  if (!key.includes("/")) return legacy.safeParse(key).success;
  const segments = key.split("/");
  return genomeUploadObjectKeySchema.safeParse(key).success && segments[2] === uploadId
    && (accountId === undefined || segments[0] === accountId);
}
