import { z } from "zod";
import { READ_CALLS_NOTE, READ_CALLS_SOURCE, readCallsMarker, type ReadInput } from "./read-call-vcf";
import { READ_CALLING_THRESHOLDS } from "./thresholds";

/**
 * The read-calling provenance a normalized VCF carries (G7.4, ADR 0038).
 *
 * Only the server's normalization writes it, and only when both hold:
 * the deployment is TEST-LOCAL (`isTestJurisdictionEnabled()`), and the
 * file's header carries the caller's exact three lines once each. Production
 * never records it, whatever a file says. It is a statement about how the
 * file says it was made, with the thresholds that were used; the thresholds
 * are engineering defaults pending scientific review, and `reviewed` is
 * always `false`.
 */

const fraction = z.number().min(0).max(1);
const count = z.number().int().nonnegative().safe();
export const readCallsProvenanceSchema = z.object({
  version: z.literal(READ_CALLING_THRESHOLDS.version),
  input: z.enum(["BAM", "CRAM"]),
  minimumDepth: count,
  minimumBaseQuality: count,
  minimumMappingQuality: count,
  heterozygousLow: fraction,
  heterozygousHigh: fraction,
  homozygousMinimum: fraction,
  reviewed: z.literal(false),
}).strict();
export type ReadCallsProvenance = z.infer<typeof readCallsProvenanceSchema>;

/** The header lines this module looks at; every other line is ignored. */
export function isReadCallsHeaderLine(line: string): boolean {
  return line.startsWith("##inheritReadCalls") || line.startsWith("##source=");
}

export function readCallsProvenance(headerLines: readonly string[], testLocal: boolean): ReadCallsProvenance | null {
  if (!testLocal) return null;
  const markers = headerLines.filter((line) => line.startsWith("##inheritReadCalls="));
  const notes = headerLines.filter((line) => line.startsWith("##inheritReadCallsNote="));
  const sources = headerLines.filter((line) => line.startsWith("##source="));
  if (markers.length !== 1 || notes.length !== 1 || sources.length !== 1) return null;
  if (notes[0] !== READ_CALLS_NOTE || sources[0] !== READ_CALLS_SOURCE) return null;
  const input = (["BAM", "CRAM"] as const).find((kind: ReadInput) => markers[0] === readCallsMarker(kind));
  if (!input) return null;
  const { version, minimumDepth, minimumBaseQuality, minimumMappingQuality, heterozygousLow, heterozygousHigh,
    homozygousMinimum, reviewed } = READ_CALLING_THRESHOLDS;
  return readCallsProvenanceSchema.parse({ version, input, minimumDepth, minimumBaseQuality, minimumMappingQuality,
    heterozygousLow, heterozygousHigh, homozygousMinimum, reviewed });
}
