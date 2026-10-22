import panelFile from "../../../../data/ref/read-calling-loci.json";
import { ReadFileError } from "./binary";
import type { ReadCallingPanel } from "./panel";
import { callReadsFile, readFileKind, type ReadCallSummary } from "./read-calls";
import { looksLikeFasta } from "./fasta";

/**
 * The uploader's one entry into read calling (TEST-LOCAL only, ADR 0038).
 * Loaded on demand, so a production page never fetches the panel or the
 * readers. It returns the VCF to upload in place of the reads; the reads and
 * their reference never leave this function.
 */

export type ReadCallingRefusal = "reads_unreadable" | "reads_reference_required" | "reads_reference_mismatch"
  | "reads_unsupported_compression" | "reads_unsupported_build" | "reads_nothing_covered" | "reads_reference_too_large";

export class ReadCallingRefused extends Error {
  constructor(readonly code: ReadCallingRefusal) { super(code); this.name = "ReadCallingRefused"; }
}

const REFUSALS: Record<ReadFileError["code"], ReadCallingRefusal> = {
  unreadable_reads: "reads_unreadable",
  reference_required: "reads_reference_required",
  reference_mismatch: "reads_reference_mismatch",
  unsupported_compression: "reads_unsupported_compression",
  unsupported_build: "reads_unsupported_build",
  nothing_covered: "reads_nothing_covered",
  too_large: "reads_reference_too_large",
};

const head = async (file: Blob) => new Uint8Array(await file.slice(0, 65_536 + 26).arrayBuffer());

/**
 * Null when none of the chosen files is BAM or CRAM reads: the ordinary
 * upload goes on unchanged. Otherwise the VCF Inherit called from them.
 */
export async function readCallsFromChosenFiles(files: readonly File[], onProgress: (percent: number) => void):
  Promise<{ vcf: File; summary: ReadCallSummary } | null> {
  const kinds = await Promise.all(files.map(async (file) => readFileKind(await head(file))));
  const readsAt = kinds.findIndex((kind) => kind !== null);
  if (readsAt === -1) return null;
  const others = files.filter((_, index) => index !== readsAt);
  if (others.length > 1 || kinds.filter((kind) => kind !== null).length > 1) throw new ReadCallingRefused("reads_unreadable");
  if (others.length === 1 && (kinds[readsAt] !== "CRAM" || !looksLikeFasta(await head(others[0])))) {
    throw new ReadCallingRefused(kinds[readsAt] === "CRAM" ? "reads_reference_mismatch" : "reads_unreadable");
  }
  try {
    const result = await callReadsFile({ reads: files[readsAt], reference: others[0] ?? null,
      panel: panelFile as unknown as ReadCallingPanel, onProgress: (fraction) => onProgress(Math.round(fraction * 100)) });
    return { vcf: new File([result.vcf], "read-calls.vcf", { type: "text/plain" }), summary: result.summary };
  } catch (error) {
    if (error instanceof ReadFileError) throw new ReadCallingRefused(REFUSALS[error.code]);
    throw new ReadCallingRefused("reads_unreadable");
  }
}
