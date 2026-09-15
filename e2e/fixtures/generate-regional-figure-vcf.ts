/** Deterministic synthetic inputs for each v3 figure-differencing state.
 * corepack pnpm exec tsx e2e/fixtures/generate-regional-figure-vcf.ts
 * Existing ancestry fixtures are never read or overwritten.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRegionalVcf, estimateRegionalFixture } from "./generate-regional-aims-vcf";
import { FIGURE_EXTRA_CALL, REGIONAL_FIGURE_PAIRS } from "./regional-figure-fixtures";

export type RegionalFigureFixture = (typeof REGIONAL_FIGURE_PAIRS)[number]["a" | "b"];

export function buildRegionalFigureVcf(fixture: RegionalFigureFixture): string {
  const source = buildRegionalVcf(fixture.seed, fixture.weights).trimEnd().split("\n");
  const headers = source.filter(row => row.startsWith("#"));
  const rows = source.filter(row => !row.startsWith("#"))
    .filter((_, index) => !fixture.dropEvery || index % fixture.dropEvery !== fixture.dropOffset);
  if (fixture.extraCall) {
    const call = FIGURE_EXTRA_CALL;
    rows.push([`chr${call.chrom}`, call.pos, ".", call.ref, call.alt, "50", "PASS", ".", "GT", call.gt].join("\t"));
  }
  rows.sort((a, b) => {
    const one = a.split("\t"), two = b.split("\t");
    return Number(one[0].slice(3)) - Number(two[0].slice(3)) || Number(one[1]) - Number(two[1]);
  });
  return [...headers, ...rows, ""].join("\n");
}

async function main() {
  for (const pair of REGIONAL_FIGURE_PAIRS) for (const fixture of [pair.a, pair.b]) {
    const source = buildRegionalFigureVcf(fixture);
    const result = await estimateRegionalFixture(source);
    if (result.markersUsed !== fixture.markers || result.reporting.merged !== pair.merged || !result.fit.converged) {
      throw new Error(`Synthetic fixture failed its intended state: ${fixture.name}`);
    }
    fs.writeFileSync(path.join(process.cwd(), "e2e/fixtures", fixture.name), source);
    console.log(`${fixture.name}: ${result.markersUsed} markers; combined=${result.reporting.merged}`);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
