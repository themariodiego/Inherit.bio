/** Validate public cohort aggregates before generating or measuring a reference. */
export const REGION_CODES = ["AFR", "AMR", "CSA", "EAS", "EUR", "MID", "OCE"] as const;
export type Region = (typeof REGION_CODES)[number];
export const REFERENCE_VERSION = "hgdp-1kg-v3.1.2-cap30-168-v1";
export const SAMPLE_CAP = 30;
export interface Marker {
  rsid: string;
  chrom: number;
  pos38: number;
  ref: string;
  alt: string;
}
export interface Counts { ac: number; an: number }
export interface Population { region: Region; samples: number }
export interface ReferenceInputs {
  markers: Marker[];
  populations: Record<string, Population>;
  counts: Record<string, Record<string, Counts>>;
}
export interface ReferenceMarker extends Marker { freqs: Record<Region, number> }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}: expected an integer from ${min} to ${max}`);
  }
  return value;
}
function sameKeys(actual: object, expected: readonly string[], label: string) {
  const keys = Object.keys(actual).sort();
  const sorted = [...expected].sort();
  if (keys.length !== sorted.length || keys.some((key, i) => key !== sorted[i])) {
    throw new Error(`${label}: missing or unexpected keys`);
  }
}
export const markerKey = (m: Marker) => `${m.chrom}-${m.pos38}-${m.ref}-${m.alt}`;

export function validateInputs(aimsInput: unknown, frequenciesInput: unknown, populationsInput: unknown): ReferenceInputs {
  if (!Array.isArray(aimsInput) || aimsInput.length !== 168) throw new Error("aims: expected exactly 168 markers");
  const seenIds = new Set<string>(), seenKeys = new Set<string>();
  const markers = aimsInput.map((value, i): Marker => {
    const m = record(value, `aims[${i}]`);
    if (typeof m.rsid !== "string" || !/^rs[1-9][0-9]*$/.test(m.rsid)) throw new Error(`aims[${i}]: invalid rsid`);
    if (typeof m.ref !== "string" || typeof m.alt !== "string" || !/^[ACGT]$/.test(m.ref) || !/^[ACGT]$/.test(m.alt) || m.ref === m.alt) {
      throw new Error(`aims[${i}]: expected distinct single-base REF and ALT`);
    }
    const marker = { rsid: m.rsid, chrom: integer(m.chrom, `aims[${i}].chrom`, 1, 22), pos38: integer(m.pos38, `aims[${i}].pos38`, 1), ref: m.ref, alt: m.alt };
    if (seenIds.has(marker.rsid) || seenKeys.has(markerKey(marker))) throw new Error(`aims[${i}]: duplicate marker`);
    seenIds.add(marker.rsid); seenKeys.add(markerKey(marker));
    return marker;
  });
  const rawPopulations = record(populationsInput, "populations");
  const populations: Record<string, Population> = {};
  for (const name of Object.keys(rawPopulations).sort()) {
    if (!name.trim()) throw new Error("populations: empty name");
    const p = record(rawPopulations[name], `populations.${name}`);
    if (!REGION_CODES.includes(p.region as Region)) throw new Error(`populations.${name}: unknown region`);
    populations[name] = { region: p.region as Region, samples: integer(p.samples, `populations.${name}.samples`, 1) };
  }
  if (REGION_CODES.some((region) => !Object.values(populations).some((p) => p.region === region))) throw new Error("populations: each of seven regions must be represented");
  const frequencies = record(frequenciesInput, "frequencies");
  sameKeys(frequencies, markers.map(markerKey), "frequencies");
  const counts: ReferenceInputs["counts"] = {};
  for (const m of markers) {
    const key = markerKey(m), row = record(frequencies[key], key);
    if (row.rsid !== m.rsid || row.ref !== m.ref || row.alt !== m.alt) throw new Error(`${key}: marker identity differs from aims.json`);
    const pops = record(row.pops, `${key}.pops`);
    sameKeys(pops, Object.keys(populations), `${key}.pops`);
    counts[key] = {};
    for (const pop of Object.keys(populations)) {
      const c = record(pops[pop], `${key}.${pop}`);
      const an = integer(c.an, `${key}.${pop}.an`, 1, populations[pop].samples * 2);
      counts[key][pop] = { ac: integer(c.ac, `${key}.${pop}.ac`, 0, an), an };
    }
  }
  return { markers, populations, counts };
}

/** Weight each population by min(30, called allele copies / 2), marker by marker. */
export function buildReference(input: ReferenceInputs, excludePopulation?: string): ReferenceMarker[] {
  if (excludePopulation !== undefined && !Object.hasOwn(input.populations, excludePopulation)) throw new Error(`Unknown held-out population: ${excludePopulation}`);
  const names = Object.keys(input.populations).sort();
  return input.markers.map((marker) => {
    const counts = input.counts[markerKey(marker)];
    const freqs = {} as Record<Region, number>;
    for (const region of REGION_CODES) {
      let weighted = 0, total = 0;
      for (const pop of names) {
        if (input.populations[pop].region !== region || pop === excludePopulation) continue;
        const { ac, an } = counts[pop];
        const weight = Math.min(SAMPLE_CAP, an / 2);
        weighted += weight * (ac / an);
        total += weight;
      }
      if (total === 0) throw new Error(`${markerKey(marker)}: no observed counts for region ${region}`);
      freqs[region] = weighted / total;
    }
    return { ...marker, freqs };
  });
}

/** Canonical source hashes do not depend on JSON spacing or object insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
