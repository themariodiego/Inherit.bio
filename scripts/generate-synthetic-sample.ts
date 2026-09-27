// Reproduce the synthetic array fixture offline. Preserve its original report
// calls and filler genotypes; repair invented coordinates the bundled chain
// cannot map. This is a transport fixture, not biological accuracy evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildLiftover } from "../src/lib/genome/liftover";
import { chromToNumber } from "../src/lib/genome/types";

interface Call { rsid: number; chrom: string; pos37: number; genotype: string }
interface Recipe { schemaVersion: number; seed: number; fillerCount: number; calls: Call[]; header: string }

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticArray(root: string): { text: string; repaired: number } {
  const recipe = JSON.parse(fs.readFileSync(path.join(root, "data/samples/synthetic-array-recipe.json"), "utf8")) as Recipe;
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.calls.length, 135);
  assert.equal(recipe.fillerCount, 2000);
  const chainBytes = fs.readFileSync(path.join(root, "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
  const lift = buildLiftover(chainBytes);
  const sourceSizes = new Map<number, number>();
  for (const line of gunzipSync(chainBytes).toString("utf8").split("\n")) {
    if (!line.startsWith("chain ")) continue;
    const fields = line.split(/\s+/);
    const chrom = chromToNumber(fields[2]);
    if (chrom !== null && fields[4] === "+") sourceSizes.set(chrom, Number(fields[3]));
  }
  // Filler must not accidentally cover any catalogue position, including the
  // eleven deliberately absent medicines positions used by the task bindings.
  const catalogue = new Set<string>();
  for (const name of fs.readdirSync(path.join(root, "data/templates")).filter(name => name.endsWith(".json"))) {
    const templates = JSON.parse(fs.readFileSync(path.join(root, "data/templates", name), "utf8")) as
      { variants?: { chrom: number; pos38: number }[] }[];
    for (const template of templates) for (const variant of template.variants ?? []) {
      catalogue.add(`${variant.chrom}:${variant.pos38}`);
    }
  }
  const occupied = new Set<string>();
  const rsids = new Set<number>();
  const rows = recipe.calls.map(call => {
    const chrom = chromToNumber(call.chrom);
    assert(chrom !== null && Number.isSafeInteger(call.pos37) && call.pos37 > 0);
    assert(/^[ACGT]{2}$/.test(call.genotype));
    assert(!rsids.has(call.rsid)); rsids.add(call.rsid);
    assert(lift(chrom, call.pos37), "A fixed synthetic call no longer lifts");
    const key = `${chrom}:${call.pos37}`;
    assert(!occupied.has(key)); occupied.add(key);
    return { ...call };
  });
  const random = mulberry32(recipe.seed);
  const repairRandom = mulberry32(recipe.seed ^ 0x4b1d2a39);
  // The original generator drew one genotype choice per report call before
  // drawing filler. Keep this stream so every filler genotype stays unchanged.
  for (let i = 0; i < recipe.calls.length; i++) random();
  const bases = ["A", "C", "G", "T"];
  let repaired = 0;
  for (let i = 0; i < recipe.fillerCount; i++) {
    const chrom = 1 + Math.floor(random() * 22);
    let pos37 = 1_000_000 + Math.floor(random() * 200_000_000);
    const genotype = [bases[Math.floor(random() * 4)], bases[Math.floor(random() * 4)]].sort().join("");
    const allowed = (position: number) => {
      const mapped = lift(chrom, position);
      return mapped !== null && mapped.chrom >= 1 && mapped.chrom <= 22
        && !catalogue.has(`${mapped.chrom}:${mapped.pos}`) && !occupied.has(`${chrom}:${position}`);
    };
    if (!allowed(pos37)) {
      repaired++;
      const size = sourceSizes.get(chrom);
      assert(size && Number.isSafeInteger(size));
      let attempts = 0;
      do {
        assert(++attempts <= 10_000, "No mapped synthetic filler position found");
        pos37 = 1 + Math.floor(repairRandom() * size);
      } while (!allowed(pos37));
    }
    const rsid = 9_000_000 + i;
    assert(!rsids.has(rsid)); rsids.add(rsid);
    occupied.add(`${chrom}:${pos37}`);
    rows.push({ rsid, chrom: String(chrom), pos37, genotype });
  }
  rows.sort((a, b) => chromToNumber(a.chrom)! - chromToNumber(b.chrom)! || a.pos37 - b.pos37);
  assert(recipe.header.startsWith("#") && recipe.header.endsWith("\n"));
  return { text: recipe.header + rows.map(row => `rs${row.rsid}\t${row.chrom}\t${row.pos37}\t${row.genotype}`).join("\n") + "\n", repaired };
}

export function generateSyntheticArray(root: string, check: boolean): void {
  const output = path.join(root, "data/samples/synthetic_23andme.txt");
  const result = syntheticArray(root);
  if (check) assert.equal(fs.readFileSync(output, "utf8"), result.text);
  else fs.writeFileSync(output, result.text);
  console.log(`Synthetic array ${check ? "verified" : "generated"}: 2135 records, ${result.repaired} repaired filler coordinates`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.slice(2).every(argument => argument === "--check"));
  generateSyntheticArray(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), process.argv.includes("--check"));
}
