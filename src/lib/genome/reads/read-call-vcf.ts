import type { LocusCall } from "./caller";
import { READ_CALLING_THRESHOLDS, type ReadCallingThresholds } from "./thresholds";

/**
 * Writes the caller's answers as the single-sample VCF the existing VCF path
 * reads (ADR 0038). Every listed row carries its reference and alternate
 * letters, its rsID when the panel has one, and its genotype or `./.`; a
 * position no read covered is left out, so the product says "not covered"
 * there exactly as it does for any VCF that does not list a position.
 *
 * The header says plainly who made the file and how: Inherit called these
 * genotypes from reads it did not generate, under engineering thresholds
 * that no scientist has reviewed. `readCallsMarker` is the exact line the
 * server looks for before it records that provenance.
 */

export type ReadInput = "BAM" | "CRAM";

export const READ_CALLS_NOTE =
  "##inheritReadCallsNote=\"Inherit called these genotypes from sequencing reads it did not generate. "
  + "The thresholds are engineering defaults pending scientific review. Positions no read covered are not listed.\"";

export function readCallsMarker(input: ReadInput, thresholds: ReadCallingThresholds = READ_CALLING_THRESHOLDS): string {
  return `##inheritReadCalls=<Version=${thresholds.version},Input=${input},MinimumDepth=${thresholds.minimumDepth},`
    + `MinimumBaseQuality=${thresholds.minimumBaseQuality},MinimumMappingQuality=${thresholds.minimumMappingQuality},`
    + `HeterozygousLow=${thresholds.heterozygousLow},HeterozygousHigh=${thresholds.heterozygousHigh},`
    + `HomozygousMinimum=${thresholds.homozygousMinimum},Reviewed=${thresholds.reviewed}>`;
}

export const READ_CALLS_SOURCE = `##source=Inherit targeted read calling ${READ_CALLING_THRESHOLDS.version}`;

export function writeReadCallVcf(calls: readonly LocusCall[], options: {
  input: ReadInput; contigOrder: readonly string[]; thresholds?: ReadCallingThresholds;
}): string {
  const thresholds = options.thresholds ?? READ_CALLING_THRESHOLDS;
  const order = new Map(options.contigOrder.map((name, index) => [name, index]));
  const rows = calls.filter((call) => call.state !== "not_covered")
    .sort((a, b) => (order.get(a.locus.contig) ?? 1e9) - (order.get(b.locus.contig) ?? 1e9)
      || a.locus.position - b.locus.position);
  const lines = [
    "##fileformat=VCFv4.2",
    READ_CALLS_SOURCE,
    "##reference=GRCh38",
    readCallsMarker(options.input, thresholds),
    READ_CALLS_NOTE,
    "##INFO=<ID=IRC,Number=1,Type=String,Description=\"Inherit read-calling outcome at this position\">",
    "##FORMAT=<ID=GT,Number=1,Type=String,Description=\"Genotype\">",
    "##FORMAT=<ID=DP,Number=1,Type=Integer,Description=\"Counted letters after the read and base filters\">",
    "##FORMAT=<ID=AD,Number=R,Type=Integer,Description=\"Counted reference and alternate letters\">",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tREADS",
  ];
  for (const call of rows) {
    const id = call.locus.rsid === null ? "." : `rs${call.locus.rsid}`;
    const filter = call.state === "called" ? "PASS" : ".";
    const outcome = call.state === "called" ? "called" : call.reason;
    lines.push([call.locus.contig, call.locus.position, id, call.locus.ref, call.alt, ".", filter,
      `IRC=${outcome}`, "GT:DP:AD", `${call.genotype}:${call.depth}:${call.refCount},${call.altCount}`].join("\t"));
  }
  return lines.join("\n") + "\n";
}
