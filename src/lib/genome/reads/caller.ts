import { alignmentEnd, baseAt, FLAG, type AlignedRead, type ReferenceSequence } from "./alignment";
import { EXCLUDED_READ_FLAGS, type ReadCallingThresholds } from "./thresholds";

/**
 * Targeted genotype calling at known positions (G7.4). This is not variant
 * discovery: it answers, for each position it is given, which of the given
 * letters the reads show, under the rule in `thresholds.ts`. Positions are
 * 1-based, as in a VCF.
 */

export interface CallerLocus {
  contig: string;
  position: number;
  ref: string;
  /** Candidate alternate letters, in priority order. */
  alts: readonly string[];
  rsid: number | null;
}

export type NoCallReason = "low_depth" | "other_letters" | "between_bands";

export interface LocusCall {
  locus: CallerLocus;
  state: "not_covered" | "no_call" | "called";
  genotype: "0/0" | "0/1" | "1/1" | "./.";
  /** The alternate letter the row reports. */
  alt: string;
  /** Counted letters (reference + every alternate + other). */
  depth: number;
  refCount: number;
  altCount: number;
  otherCount: number;
  /** Reads overlapping the position before any filter. */
  overlapping: number;
  reason: NoCallReason | null;
}

interface Tally {
  overlapping: number;
  counts: Map<string, number>;
  fragments: Map<string, string | null>;
}

const EPSILON = 1e-9;

export function genotypeFromCounts(locus: CallerLocus, tally: { overlapping: number; counts: ReadonlyMap<string, number> },
  thresholds: ReadCallingThresholds): LocusCall {
  const count = (letter: string) => tally.counts.get(letter) ?? 0;
  const refCount = count(locus.ref);
  let alt = locus.alts[0];
  for (const candidate of locus.alts) if (count(candidate) > count(alt)) alt = candidate;
  const altCount = count(alt);
  let depth = 0;
  for (const value of tally.counts.values()) depth += value;
  const otherCount = depth - refCount - altCount;
  const base = { locus, alt, depth, refCount, altCount, otherCount, overlapping: tally.overlapping };
  if (tally.overlapping === 0) return { ...base, state: "not_covered", genotype: "./.", reason: null };
  const noCall = (reason: NoCallReason): LocusCall => ({ ...base, state: "no_call", genotype: "./.", reason });
  if (depth < thresholds.minimumDepth) return noCall("low_depth");
  if (otherCount > (1 - thresholds.homozygousMinimum) * depth + EPSILON) return noCall("other_letters");
  const fraction = altCount / (refCount + altCount);
  const called = (genotype: LocusCall["genotype"]): LocusCall => ({ ...base, state: "called", genotype, reason: null });
  if (fraction <= 1 - thresholds.homozygousMinimum + EPSILON) return called("0/0");
  if (fraction >= thresholds.homozygousMinimum - EPSILON) return called("1/1");
  if (fraction >= thresholds.heterozygousLow - EPSILON && fraction <= thresholds.heterozygousHigh + EPSILON) return called("0/1");
  return noCall("between_bands");
}

/** The letter one read contributes at one position, or null when it counts for nothing. */
export function readLetter(read: AlignedRead, position: number, thresholds: ReadCallingThresholds): string | null {
  if (read.flag & EXCLUDED_READ_FLAGS) return null;
  if (read.mapq < thresholds.minimumMappingQuality || read.mapq === 255) return null;
  const at = baseAt(read, position - 1);
  if (at === null) return null;
  if (at === "deletion") return "-";
  if (at.quality === 255 || at.quality < thresholds.minimumBaseQuality) return null;
  if (!/^[ACGT]$/.test(at.base)) return null;
  return at.base;
}

export async function callLoci(records: AsyncIterable<AlignedRead>, references: readonly ReferenceSequence[],
  loci: readonly CallerLocus[], thresholds: ReadCallingThresholds): Promise<LocusCall[]> {
  const tallies = loci.map((): Tally => ({ overlapping: 0, counts: new Map(), fragments: new Map() }));
  const byReference = new Map<number, { position: number; index: number }[]>();
  references.forEach((reference, refId) => {
    const here = loci.flatMap((locus, index) => locus.contig === reference.name ? [{ position: locus.position, index }] : []);
    if (here.length) byReference.set(refId, here.sort((a, b) => a.position - b.position));
  });
  for await (const read of records) {
    const positions = byReference.get(read.refId);
    if (!positions || read.flag & FLAG.unmapped) continue;
    const start = read.pos + 1;
    const end = alignmentEnd(read); // 1-based inclusive end equals the 0-based exclusive end
    let low = 0, high = positions.length;
    while (low < high) { const mid = (low + high) >> 1; if (positions[mid].position < start) low = mid + 1; else high = mid; }
    for (let i = low; i < positions.length && positions[i].position <= end; i++) {
      const tally = tallies[positions[i].index];
      tally.overlapping++;
      const letter = readLetter(read, positions[i].position, thresholds);
      if (letter === null) continue;
      if (read.flag & FLAG.paired) {
        if (tally.fragments.has(read.name)) {
          const prior = tally.fragments.get(read.name);
          if (prior !== null && prior !== undefined && prior !== letter) {
            tally.counts.set(prior, (tally.counts.get(prior) ?? 0) - 1);
            tally.fragments.set(read.name, null);
          }
          continue;
        }
        tally.fragments.set(read.name, letter);
      }
      tally.counts.set(letter, (tally.counts.get(letter) ?? 0) + 1);
    }
  }
  return loci.map((locus, index) => genotypeFromCounts(locus, tallies[index], thresholds));
}
