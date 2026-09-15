/** Independent synthetic fixtures for both branches of the new reporting rule.
 * No personal genotypes or old fixture files are read or changed.
 * corepack pnpm exec tsx e2e/fixtures/generate-regional-aims-vcf.ts
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { REGIONAL_AIMS, REGIONAL_POPS, estimateRegionalAdmixture, type RegionalProportions } from "../../src/lib/genome/regional-admixture";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";
import { REGIONAL_FIXTURES } from "./regional-aims-fixtures";
export { REGIONAL_FIXTURES } from "./regional-aims-fixtures";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function buildRegionalVcf(seed: number, weights: RegionalProportions): string {
  const random = mulberry32(seed);
  const rows = [...REGIONAL_AIMS].sort((a, b) => a.chrom - b.chrom || a.pos38 - b.pos38).map(marker => {
    const copies = [0, 1].map(() => {
      let draw = random();
      let pop = REGIONAL_POPS.at(-1)!;
      for (const candidate of REGIONAL_POPS) { draw -= weights[candidate]; if (draw < 0) { pop = candidate; break; } }
      return random() < marker.freqs[pop] ? 1 : 0;
    });
    return [`chr${marker.chrom}`, marker.pos38, marker.rsid, marker.ref, marker.alt, "50", "PASS", ".", "GT", copies.sort().join("/")].join("\t");
  });
  return ["##fileformat=VCFv4.2", "##reference=GRCh38",
    `##source=Inherit synthetic seven-region fixture; no real person; seed ${seed}`,
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC", ...rows, ""].join("\n");
}
export async function estimateRegionalFixture(text: string) {
  async function* lines() { yield* text.split("\n"); }
  const parsed = await parseVcf(lines());
  const calls = new Map((parsed.observedCalls ?? []).filter(call => call.usable).map(call => [`${call.chrom}:${call.pos}`, call.genotype]));
  return estimateRegionalAdmixture((chrom, pos) => calls.get(`${chrom}:${pos}`) ?? null);
}
async function main() {
  for (const fixture of REGIONAL_FIXTURES) {
    const bytes = buildRegionalVcf(fixture.seed, fixture.weights);
    const result = await estimateRegionalFixture(bytes);
    if (result.markersUsed !== REGIONAL_AIMS.length || !result.fit.converged || result.reporting.merged !== fixture.merged) {
      throw new Error(`Synthetic ${fixture.name} does not satisfy its intended reporting branch: ${JSON.stringify(result)}`);
    }
    fs.writeFileSync(path.join(process.cwd(), "e2e/fixtures", fixture.name), bytes);
    console.log(JSON.stringify({ fixture: fixture.name, seed: fixture.seed, markers: result.markersUsed,
      merged: result.reporting.merged, fit: result.fit, proportions: result.proportions,
      sha256: createHash("sha256").update(bytes).digest("hex") }));
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
