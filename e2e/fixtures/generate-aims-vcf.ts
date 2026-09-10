// Generates e2e/fixtures/aims-mixed-grch38.vcf: a synthetic single-sample
// GRCh38 VCF with one row at every position of the shipped ancestry marker
// panel (`data/ref/aims.json`), so the ancestry page's shown state (map,
// toggle, chips, table, panel) has an end-to-end test. It describes no real
// person: every genotype is drawn from a seeded pseudo-random generator
// (mulberry32, the same draw `src/lib/genome/admixture.test.ts` uses) with
// each allele copy taken from one reference superpopulation by the mixing
// weights below, then ALT with that population's panel frequency.
//
//   pnpm exec tsx e2e/fixtures/generate-aims-vcf.ts
//
// The output is byte-identical across runs. After writing, the script parses
// the file with the real VCF parser and runs the real estimator over the
// parsed records, and fails unless the result has at least MIN_MARKERS
// usable markers (the map is shown, not grey) and at least one region below
// the well-supported threshold (the toggle hides something). The VCF parser
// drops homozygous-reference rows, so "markers used" counts the panel
// positions that carry at least one ALT allele.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MIN_MARKERS } from "../../src/lib/ancestry/panel";
import { WELL_SUPPORTED_MIN } from "../../src/lib/ancestry/present";
import { AIMS, POPS, estimateAdmixture, type AdmixtureResult, type Pop } from "../../src/lib/genome/admixture";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";

export const FIXTURE_NAME = "aims-mixed-grch38.vcf";

/** Mixing weights per allele copy (design §6.2): one region falls below 2%. */
export const WEIGHTS: Record<Pop, number> = { AFR: 0.3, AMR: 0, EAS: 0.1, EUR: 0.6, SAS: 0 };

/**
 * The seed is the first one (searched upward from 1) whose draw satisfies
 * both checks in `verify()`, leaves at least three regions at or above the
 * threshold (both toggle states list more than one region), and puts one
 * region strictly between 0 and the threshold (the hidden chip is not 0.0%).
 * Its draw also leaves one region at exactly 0, which renders as a dashed
 * hairline when the toggle is off.
 */
export const SEED = 13;

/**
 * Seed B, for G8.3: the same surface rendered from a different person, so
 * every figure on it has to move. `aims-mixed-b-grch38.vcf` also describes no
 * real person.
 *
 * Both the seed and the mixing weights change, because the seed alone is not
 * enough — redrawing the same mixture lands near the same proportions, and a
 * differencing gate whose two seeds agree to one decimal proves nothing. These
 * weights were chosen by searching for a draw where all five regions differ
 * from seed A at the precision the page renders. With the dropped positions
 * below, seed B estimates AFR 5.7 against seed A's 25.5, AMR 44.8 against
 * 65.2, EAS 19.6 against 8.8, EUR 0.0 against 0.5, and SAS 29.9 against 0.0.
 * An earlier candidate left SAS at 0.0 under both, which would have forced a
 * region into the seed-invariant register for no better reason than
 * coincidence — exactly the weakening that register must not absorb.
 */
export const SEED_B = 21;
export const WEIGHTS_B: Record<Pop, number> = { AFR: 0.1, AMR: 0, EAS: 0.1, EUR: 0.2, SAS: 0.6 };
/** Seed B drops every twelfth panel position, so its coverage differs from seed A's. */
export const DROP_EVERY_B = 12;
export const FIXTURE_NAME_B = "aims-mixed-b-grch38.vcf";

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One diploid genotype as a VCF GT field: each copy picks a superpopulation by weight, then ALT with its frequency. */
function drawGt(rnd: () => number, freqs: Record<Pop, number>, weights: Record<Pop, number>): string {
  const copies: number[] = [];
  for (let copy = 0; copy < 2; copy++) {
    let u = rnd();
    let pop: Pop = POPS[POPS.length - 1];
    for (const p of POPS) {
      u -= weights[p];
      if (u < 0) {
        pop = p;
        break;
      }
    }
    copies.push(rnd() < freqs[pop] ? 1 : 0);
  }
  return copies.sort().join("/");
}

/** The fixture's lines (no trailing newline on the last line). */
export function buildAimsVcf(
  seed: number,
  weights: Record<Pop, number> = WEIGHTS,
  /**
   * Drop every nth panel position; 0 drops none, so seed A is unchanged. Seed
   * B drops a few so the coverage figures move too: a real upload need not
   * carry every marker the panel wants, and without this both coverage figures
   * read "168 of 168" under either seed and would have had to be registered as
   * seed-invariant — weakening the gate to accommodate a fixture rather than
   * describing the product.
   *
   * Kept deliberately gentle. An earlier attempt kept only every fourth
   * position and left 19 usable markers against a floor of 42, which renders
   * the grey state: the two seeds would then differ by rendering different
   * surfaces rather than different values, which is not what this proves.
   */
  dropEvery = 0,
): string[] {
  const rnd = mulberry32(seed);
  const rows = [...AIMS]
    .sort((a, b) => a.chrom - b.chrom || a.pos38 - b.pos38)
    .filter((_, index) => dropEvery === 0 || index % dropEvery !== 0)
    .map((m) => [`chr${m.chrom}`, String(m.pos38), m.rsid, m.ref, m.alt, "50", "PASS", ".", "GT", drawGt(rnd, m.freqs, weights)].join("\t"));
  return [
    "##fileformat=VCFv4.2",
    `##source=Inherit deterministic synthetic fixture; no real person; seed ${seed}; generated by e2e/fixtures/generate-aims-vcf.ts`,
    "##reference=GRCh38",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT", "SAMPLE1"].join("\t"),
    ...rows,
  ];
}

async function* asLines(lines: string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

/** What the process route would store for this fixture: the real parser, then the real estimator. */
export async function estimateFixture(lines: string[]): Promise<AdmixtureResult> {
  const parsed = await parseVcf(asLines(lines));
  const byPos = new Map(parsed.records.map((r) => [`${r.chrom}:${r.pos}`, r.genotype]));
  return estimateAdmixture((chrom, pos) => byPos.get(`${chrom}:${pos}`) ?? null);
}

export interface FixtureCheck {
  ok: boolean;
  markersUsed: number;
  proportions: Record<Pop, number>;
  belowThreshold: Pop[];
  reasons: string[];
}

export function verify(result: AdmixtureResult): FixtureCheck {
  const belowThreshold = POPS.filter((pop) => result.proportions[pop] < WELL_SUPPORTED_MIN);
  const reasons: string[] = [];
  if (result.markersUsed < MIN_MARKERS) {
    reasons.push(`markersUsed ${result.markersUsed} is below MIN_MARKERS ${MIN_MARKERS}: the map would be grey`);
  }
  if (belowThreshold.length === 0) {
    reasons.push(`no region is below the well-supported threshold ${WELL_SUPPORTED_MIN}: the toggle would hide nothing`);
  }
  return { ok: reasons.length === 0, markersUsed: result.markersUsed, proportions: result.proportions, belowThreshold, reasons };
}

async function writeFixture(name: string, seed: number, weights: Record<Pop, number>, dropEvery = 0): Promise<boolean> {
  const lines = buildAimsVcf(seed, weights, dropEvery);
  const result = await estimateFixture(lines);
  const check = verify(result);
  if (!check.ok) {
    console.error(`fixture check failed for seed ${seed}:\n  - ${check.reasons.join("\n  - ")}`);
    return false;
  }
  const text = `${lines.join("\n")}\n`;
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), name);
  fs.writeFileSync(target, text);
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  console.log(`wrote ${path.relative(process.cwd(), target)} (${text.length} bytes, ${lines.length - 5} rows)`);
  console.log(`markers used: ${check.markersUsed} of ${AIMS.length} (minimum ${MIN_MARKERS})`);
  console.log(`proportions: ${POPS.map((pop) => `${pop} ${check.proportions[pop].toFixed(3)}`).join(", ")}`);
  console.log(`below ${WELL_SUPPORTED_MIN}: ${check.belowThreshold.join(", ")}`);
  console.log(`sha256: ${sha256}`);
  return true;
}

async function main() {
  const a = await writeFixture(FIXTURE_NAME, SEED, WEIGHTS);
  const b = await writeFixture(FIXTURE_NAME_B, SEED_B, WEIGHTS_B, DROP_EVERY_B);
  if (!a || !b) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
