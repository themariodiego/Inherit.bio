// Generates e2e/fixtures/density-source-grch38.vcf: the synthetic source the
// POST-CHANGE density capture uploads (G2.5).
//
//   pnpm exec tsx e2e/fixtures/generate-density-source-vcf.ts
//
// WHY A THIRD FIXTURE RATHER THAN ONE OF THE TWO THAT EXIST. The post-change
// capture has to put each successor page in the state its predecessor was
// measured in, or the comparison measures a state change and calls it a
// density change. `aims-mixed-grch38.vcf` carries the ancestry panel and no
// report locus, so the report library and the one report the baseline
// measured would render an absence. `tiny-grch38.vcf` carries a handful of
// loci and one usable ancestry marker, which renders the grey map. Neither is
// the shape the baseline's own fixture had: a source broad enough that every
// authenticated surface has something to show.
//
// So this one is the union of the two things the surfaces read: every position
// of the shipped ancestry panel (`data/ref/aims.json`) and every variant
// position the shipped report catalogue names (`data/templates/*.json`). It
// describes no real person. The ancestry half is drawn exactly as
// `generate-aims-vcf.ts` draws it, by the same seeded generator and the same
// mixing weights, so the map it produces is the one that fixture's own checks
// already constrain; the catalogue half is drawn by the same generator at a
// fixed per-copy ALT probability.
//
// Where the two sets overlap — five positions — THE ANCESTRY DRAW WINS. The
// estimator reads every panel position and a report reads one, so a panel
// position taken from the catalogue draw would move the map to spare a single
// report card a genotype it can read either way.
//
// The output is byte-identical across runs, and the script verifies it after
// writing: the real parser, the real estimator, at least MIN_MARKERS usable
// markers (the map is shown, not grey), and an ALT allele at the one locus the
// baseline's measured report needs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MIN_MARKERS } from "../../src/lib/ancestry/panel";
import { AIMS, POPS, type Pop } from "../../src/lib/genome/admixture";
import { WEIGHTS, estimateFixture, mulberry32 } from "./generate-aims-vcf";

export const FIXTURE_NAME = "density-source-grch38.vcf";

/**
 * The locus behind `/reports/type-2-diabetes-tcf7l2-rs7903146`, which is the
 * report the baseline measured and therefore the one the post-change capture
 * must be able to show. Named here rather than left to chance in a draw: this
 * fixture exists to make that page renderable.
 */
export const REQUIRED_LOCUS = { chrom: 10, pos38: 112998590 };

/** Per-copy ALT probability at a catalogue locus. Half, so the cards vary. */
const CATALOGUE_ALT = 0.5;

interface Locus {
  chrom: number;
  pos38: number;
  ref: string;
  alt: string;
  id: string;
  panel: boolean;
  freqs?: Record<Pop, number>;
}

/** Every variant position the shipped catalogue names, first declaration wins. */
export function catalogueLoci(repositoryRoot: string): Locus[] {
  const directory = path.join(repositoryRoot, "data/templates");
  const seen = new Map<string, Locus>();
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    const templates = (Array.isArray(parsed) ? parsed : []) as { variants?: unknown }[];
    for (const template of templates) {
      for (const variant of (template.variants ?? []) as Record<string, unknown>[]) {
        const chrom = variant.chrom, pos38 = variant.pos38;
        const ref = variant.ref, alt = variant.alt, rsid = variant.rsid;
        if (typeof chrom !== "number" || typeof pos38 !== "number") continue;
        if (typeof ref !== "string" || typeof alt !== "string") continue;
        const key = `${chrom}:${pos38}`;
        if (seen.has(key)) continue;
        seen.set(key, { chrom, pos38, ref, alt, panel: false,
          id: typeof rsid === "number" ? `rs${rsid}` : "." });
      }
    }
  }
  return [...seen.values()];
}

/** One diploid GT: each copy picks a superpopulation by weight, then ALT with its frequency. */
function panelGt(rnd: () => number, freqs: Record<Pop, number>): string {
  const copies: number[] = [];
  for (let copy = 0; copy < 2; copy++) {
    let u = rnd();
    let pop: Pop = POPS[POPS.length - 1];
    for (const p of POPS) {
      u -= WEIGHTS[p];
      if (u < 0) { pop = p; break; }
    }
    copies.push(rnd() < freqs[pop] ? 1 : 0);
  }
  return copies.sort().join("/");
}

function catalogueGt(rnd: () => number): string {
  const copies = [rnd() < CATALOGUE_ALT ? 1 : 0, rnd() < CATALOGUE_ALT ? 1 : 0];
  return copies.sort().join("/");
}

/** The fixture's lines (no trailing newline on the last line). */
export function buildDensityVcf(repositoryRoot: string, seed: number): string[] {
  const byPosition = new Map<string, Locus>();
  for (const locus of catalogueLoci(repositoryRoot)) byPosition.set(`${locus.chrom}:${locus.pos38}`, locus);
  // The panel overwrites, which is the overlap rule stated above.
  for (const marker of AIMS) {
    byPosition.set(`${marker.chrom}:${marker.pos38}`, {
      chrom: marker.chrom, pos38: marker.pos38, ref: marker.ref, alt: marker.alt,
      id: marker.rsid, panel: true, freqs: marker.freqs,
    });
  }
  const rnd = mulberry32(seed);
  const rows = [...byPosition.values()]
    .sort((a, b) => a.chrom - b.chrom || a.pos38 - b.pos38)
    .map((locus) => [
      `chr${locus.chrom}`, String(locus.pos38), locus.id, locus.ref, locus.alt,
      "50", "PASS", ".", "GT",
      locus.panel ? panelGt(rnd, locus.freqs!) : catalogueGt(rnd),
    ].join("\t"));
  return [
    "##fileformat=VCFv4.2",
    `##source=Inherit deterministic synthetic fixture; no real person; seed ${seed}; generated by e2e/fixtures/generate-density-source-vcf.ts`,
    "##reference=GRCh38",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT", "SAMPLE1"].join("\t"),
    ...rows,
  ];
}

export interface DensityFixtureCheck {
  markersUsed: number;
  mapShown: boolean;
  requiredLocusCarriesAlt: boolean;
  rowCount: number;
}

export function checkLines(lines: string[], markersUsed: number): DensityFixtureCheck {
  const prefix = `chr${REQUIRED_LOCUS.chrom}\t${REQUIRED_LOCUS.pos38}\t`;
  const row = lines.find((line) => line.startsWith(prefix));
  const genotype = row?.split("\t").at(-1) ?? "";
  return {
    markersUsed,
    mapShown: markersUsed >= MIN_MARKERS,
    requiredLocusCarriesAlt: genotype.includes("1"),
    rowCount: lines.filter((line) => !line.startsWith("#")).length,
  };
}

/** The first seed from 1 upward whose draw shows the map and can show that report. */
export async function findSeed(repositoryRoot: string, limit = 200): Promise<number> {
  for (let seed = 1; seed <= limit; seed++) {
    const lines = buildDensityVcf(repositoryRoot, seed);
    const check = checkLines(lines, (await estimateFixture(lines)).markersUsed);
    if (check.mapShown && check.requiredLocusCarriesAlt) return seed;
  }
  throw new Error(`No seed below ${limit} both shows the map and carries the required locus`);
}

const thisFile = fileURLToPath(import.meta.url);

async function main() {
  const repositoryRoot = path.resolve(path.dirname(thisFile), "../..");
  const seed = await findSeed(repositoryRoot);
  const lines = buildDensityVcf(repositoryRoot, seed);
  const check = checkLines(lines, (await estimateFixture(lines)).markersUsed);
  if (!check.mapShown || !check.requiredLocusCarriesAlt) {
    throw new Error(`Fixture check failed: ${JSON.stringify(check)}`);
  }
  const text = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(path.dirname(thisFile), FIXTURE_NAME), text);
  console.log(JSON.stringify({
    fixture: FIXTURE_NAME, seed, ...check,
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
  }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(thisFile).href) {
  void main();
}
