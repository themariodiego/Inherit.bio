/** Two synthetic embryos in one VCF, as separate samples; no person's genome is read.
 *
 * The embryo-ingest completion contract refuses a cohort upload that resolves
 * to exactly one sample (`cohort_single_sample`, docs/route-register.json), so
 * the two embryos the comprehension protocol's `participant-c` compares travel
 * in one file, as a laboratory would send them (owner decision, 28 September
 * 2026). Positions are real GRCh38 autosomal coordinates read from the public
 * `data/ref/build-discriminating-sites.json`; every allele and every genotype
 * is drawn here from a fixed seed. Both embryos call at or above the embryo
 * quality policy's no-figure floor, so neither fails ingest's quality bands.
 *
 * Run: corepack pnpm exec tsx scripts/generate-embryo-pair-fixture.ts [--check]
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EMBRYO_PAIR_FIXTURE = "e2e/fixtures/embryo-pair-grch38.vcf";
const GENERATOR = "scripts/generate-embryo-pair-fixture.ts";
const SITES = "data/ref/build-discriminating-sites.json";
const BASES = "ACGT";
export const SAMPLES = ["SAMPLE1", "SAMPLE2"] as const;
export const SITE_COUNT = 1200;
/** Every hundredth site is uncalled in the second embryo: a 99% call rate, not a perfect one. */
export const SECOND_EMBRYO_MISSING_EVERY = 100;
/**
 * GRCh38 lengths of the autosomes this fixture uses: exactly the contigs the
 * committed VCF fixtures already declare, and the test re-reads every one of
 * them from those files rather than trusting this table.
 */
export const CONTIG_LENGTHS: Readonly<Record<number, number>> = {
  1: 248956422, 2: 242193529, 6: 170805979, 7: 159345973, 10: 133797422, 11: 135086622,
  12: 133275309, 13: 114364328, 15: 101991189, 16: 90338345, 22: 50818468,
};
/** The fixed seed. Changing it changes every genotype, and the committed file with it. */
const SEED = 0x28_09_2026;

/** mulberry32: a small, well-known deterministic generator; not for anything secret. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Site = { rsid: number; chrom: number; pos38: number };

/** Evenly spaced sites on the chosen autosomes, in genome order, one per position. */
export function chooseSites(repositoryRoot: string): Site[] {
  const reference = JSON.parse(readFileSync(path.join(repositoryRoot, SITES), "utf8")) as {
    columns: string[]; sites: [number, number, number, number][];
  };
  assert.deepEqual(reference.columns.length, 4);
  const byPosition = new Map<string, Site>();
  for (const [rsid, chrom, , pos38] of reference.sites) {
    if (!(chrom in CONTIG_LENGTHS)) continue;
    assert(pos38 > 0 && pos38 <= CONTIG_LENGTHS[chrom], `rs${rsid} lies inside chr${chrom}`);
    const key = `${chrom}:${pos38}`;
    if (!byPosition.has(key)) byPosition.set(key, { rsid, chrom, pos38 });
  }
  const ordered = [...byPosition.values()].sort((a, b) => a.chrom - b.chrom || a.pos38 - b.pos38);
  assert(ordered.length >= SITE_COUNT, "enough reference sites on the chosen autosomes");
  const step = Math.floor(ordered.length / SITE_COUNT);
  return Array.from({ length: SITE_COUNT }, (_, index) => ordered[index * step]);
}

function genotype(draw: number): string {
  return draw < 0.45 ? "0/0" : draw < 0.8 ? "0/1" : "1/1";
}

export function buildEmbryoPairVcf(repositoryRoot: string): string {
  const sites = chooseSites(repositoryRoot);
  const random = generator(SEED);
  const used = [...new Set(sites.map((site) => site.chrom))];
  const lines = [
    "##fileformat=VCFv4.2",
    `##source=Inherit deterministic synthetic fixture; no real person; two synthetic embryos as separate samples; ${GENERATOR}`,
    "##reference=GRCh38",
    ...used.map((chrom) => `##contig=<ID=chr${chrom},length=${CONTIG_LENGTHS[chrom]}>`),
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT", ...SAMPLES].join("\t"),
  ];
  sites.forEach((site, index) => {
    const ref = BASES[Math.floor(random() * 4)];
    const alt = BASES[(BASES.indexOf(ref) + 1 + Math.floor(random() * 3)) % 4];
    const first = genotype(random());
    const drawn = genotype(random());
    const second = index % SECOND_EMBRYO_MISSING_EVERY === SECOND_EMBRYO_MISSING_EVERY - 1 ? "./." : drawn;
    lines.push([`chr${site.chrom}`, site.pos38, `rs${site.rsid}`, ref, alt, 50, "PASS", ".", "GT", first, second].join("\t"));
  });
  return `${lines.join("\n")}\n`;
}

export function generateEmbryoPairFixture(repositoryRoot: string, check: boolean): void {
  const text = buildEmbryoPairVcf(repositoryRoot);
  const target = path.join(repositoryRoot, EMBRYO_PAIR_FIXTURE);
  if (check) assert.equal(readFileSync(target, "utf8"), text, `${EMBRYO_PAIR_FIXTURE} is not what ${GENERATOR} writes`);
  else writeFileSync(target, text);
  console.log(`${EMBRYO_PAIR_FIXTURE}: ${check ? "verified" : "generated"}, ${SITE_COUNT} records, ${SAMPLES.length} samples`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.slice(2).every((argument) => argument === "--check"));
  generateEmbryoPairFixture(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), process.argv.includes("--check"));
}
