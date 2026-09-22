import "server-only";

/**
 * Evidence for an assay-qualified chromosome-sex caller. These statistics
 * do not themselves establish chromosome copy number or a clinical result.
 * There is deliberately no production panel, default cutoff or sex call here.
 * See docs/design/chromosomal-sex-result.md for the outstanding qualification.
 */
export interface SexEvidenceMarker {
  chrom: 23 | 24;
  pos: number;
  ref: string;
  alt: string;
  /** Required for X; a reference-population frequency, never from this embryo. */
  altFrequency: number | null;
}

export interface SexEvidenceObservation {
  chrom: number;
  pos: number;
  /** Decoded literal alleles. Explicit no-calls are distinct from absent rows. */
  genotype: string;
}

export interface ChromosomalSexEvidence {
  x: {
    assayed: number;
    observed: number;
    called: number;
    heterozygous: number;
    expectedHeterozygous: number;
    inbreedingCoefficient: number | null;
  };
  y: {
    assayed: number;
    observed: number;
    called: number;
    heterozygous: number;
    /** Null unless every assayed Y marker has an explicit source observation. */
    validCallRate: number | null;
  };
}

const NON_PAR = {
  GRCh37: { 23: { after: 2_699_520, before: 154_931_044 }, 24: { after: 2_649_520, before: 59_034_050 } },
  GRCh38: { 23: { after: 2_781_479, before: 155_701_383 }, 24: { after: 2_781_479, before: 56_887_903 } },
} as const;

const key = (chrom: number, pos: number) => `${chrom}:${pos}`;

function markerMap(build: keyof typeof NON_PAR, markers: readonly SexEvidenceMarker[]) {
  if (!Object.hasOwn(NON_PAR, build)) throw new Error("sex-evidence:invalid-panel");
  const ranges = NON_PAR[build];
  if (!ranges || markers.length === 0) throw new Error("sex-evidence:invalid-panel");
  const index = new Map<string, SexEvidenceMarker>();
  for (const marker of markers) {
    const range = ranges[marker.chrom];
    if (![23, 24].includes(marker.chrom) || !Number.isSafeInteger(marker.pos) || marker.pos < 1 ||
      marker.pos <= range.after || marker.pos >= range.before ||
      !/^[ACGT]$/.test(marker.ref) || !/^[ACGT]$/.test(marker.alt) || marker.ref === marker.alt ||
      (marker.chrom === 23 && (typeof marker.altFrequency !== "number" || !Number.isFinite(marker.altFrequency) ||
        marker.altFrequency <= 0 || marker.altFrequency >= 1)) ||
      (marker.chrom === 24 && marker.altFrequency !== null)) throw new Error("sex-evidence:invalid-panel");
    const id = key(marker.chrom, marker.pos);
    if (index.has(id)) throw new Error("sex-evidence:duplicate-panel-locus");
    index.set(id, marker);
  }
  // X alone cannot establish that Y is absent, and Y alone cannot resolve X.
  if (!markers.some(marker => marker.chrom === 23) || !markers.some(marker => marker.chrom === 24)) {
    throw new Error("sex-evidence:incomplete-panel");
  }
  return index;
}

function alleles(value: string, marker: SexEvidenceMarker): string[] | null {
  // A source row is retained even when missing, but missing alleles contribute
  // neither observed heterozygosity nor a called-marker denominator.
  const normalized = value === "--" ? "./." : value === "-" ? "." : value;
  if (!/^(?:[ACGT]|\.)(?:[/|](?:[ACGT]|\.))?$/.test(normalized)) {
    throw new Error("sex-evidence:unsupported-call");
  }
  const parts = normalized.split(/[/|]/);
  if (parts.some(allele => allele !== "." && allele !== marker.ref && allele !== marker.alt)) {
    throw new Error("sex-evidence:allele-mismatch");
  }
  return parts.includes(".") ? null : parts;
}

/**
 * Compute once per source position, including explicit reference calls.
 * The caller must supply the exact qualified assay panel and population
 * reference. Variant-only records are not an assay coverage manifest.
 */
export function chromosomalSexEvidence(
  build: keyof typeof NON_PAR,
  markers: readonly SexEvidenceMarker[],
  observations: Iterable<SexEvidenceObservation>,
): ChromosomalSexEvidence {
  const index = markerMap(build, markers);
  const seen = new Set<string>();
  const x: ChromosomalSexEvidence["x"] = { assayed: markers.filter(marker => marker.chrom === 23).length,
    observed: 0, called: 0, heterozygous: 0, expectedHeterozygous: 0, inbreedingCoefficient: null };
  const y: ChromosomalSexEvidence["y"] = { assayed: markers.length - x.assayed,
    observed: 0, called: 0, heterozygous: 0, validCallRate: null };
  for (const observation of observations) {
    const id = key(observation.chrom, observation.pos);
    const marker = index.get(id);
    if (!marker) continue;
    // Even identical duplicates cannot inflate the evidence or hide a conflict.
    if (seen.has(id)) throw new Error("sex-evidence:duplicate-source-locus");
    seen.add(id);
    const part = marker.chrom === 23 ? x : y;
    part.observed++;
    const called = alleles(observation.genotype, marker);
    if (!called) continue;
    const heterozygous = new Set(called).size > 1;
    if (heterozygous) part.heterozygous++;
    // A heterozygous non-PAR Y call is a discordance to review, not Y evidence.
    if (marker.chrom === 24 && heterozygous) continue;
    part.called++;
    if (marker.chrom === 23) {
      const frequency = marker.altFrequency!;
      x.expectedHeterozygous += 2 * frequency * (1 - frequency);
    }
  }
  if (x.expectedHeterozygous > 0) {
    x.inbreedingCoefficient = 1 - x.heterozygous / x.expectedHeterozygous;
    if (!Number.isFinite(x.inbreedingCoefficient)) throw new Error("sex-evidence:unusable-reference-frequency");
  }
  if (y.observed === y.assayed) y.validCallRate = y.called / y.assayed;
  return { x, y };
}
