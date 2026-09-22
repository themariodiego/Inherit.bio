import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildLiftover } from "../src/lib/genome/liftover";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://rest.ensembl.org";
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
type Point = { rsid: number; chrom: number; pos38: number };
type Block = { start: number; end: number; sourceStart: number; size: number; negative: boolean; maxEnd: number };

/** Invert only same-chromosome autosomal chain blocks. A multiply mapped point
 * is rejected rather than assigned the first plausible source coordinate. */
export function inverseChain(chain: Uint8Array): (chrom: number, pos: number) => number | null {
  const byChrom = new Map<number, Block[]>();
  const forward = buildLiftover(chain);
  let current: { chrom: number; source: number; target: number; targetSize: number; negative: boolean } | null = null;
  for (const line of gunzipSync(chain).toString("utf8").split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === "chain") {
      const chrom = Number(fields[2]);
      current = Number.isInteger(chrom) && chrom >= 1 && chrom <= 22 && fields[2] === fields[7] && fields[4] === "+"
        ? { chrom, source: Number(fields[5]), target: Number(fields[10]), targetSize: Number(fields[8]), negative: fields[9] === "-" }
        : null;
    } else if (!line.trim()) current = null;
    else if (current) {
      const size = Number(fields[0]);
      const start = current.negative ? current.targetSize - current.target - size : current.target;
      const blocks = byChrom.get(current.chrom) ?? [];
      blocks.push({ start, end: start + size, sourceStart: current.source, size, negative: current.negative, maxEnd: 0 });
      byChrom.set(current.chrom, blocks);
      current.source += size + Number(fields[1] ?? 0);
      current.target += size + Number(fields[2] ?? 0);
    }
  }
  for (const blocks of byChrom.values()) {
    blocks.sort((a, b) => a.start - b.start);
    let maximum = 0;
    for (const block of blocks) block.maxEnd = maximum = Math.max(maximum, block.end);
  }
  return (chrom, pos) => {
    const blocks = byChrom.get(chrom) ?? [];
    const target = pos - 1;
    let low = 0, high = blocks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (blocks[middle].start <= target) low = middle + 1;
      else high = middle;
    }
    const candidates = new Set<number>();
    for (let index = low - 1; index >= 0 && blocks[index].maxEnd > target; index--) {
      const block = blocks[index];
      if (target >= block.end) continue;
      candidates.add(block.sourceStart + (block.negative ? block.end - 1 - target : target - block.start) + 1);
    }
    if (candidates.size !== 1) return null;
    const source = [...candidates][0];
    const result = forward(chrom, source);
    return result?.chrom === chrom && result.pos === pos ? source : null;
  };
}

async function fetchBounded(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { accept: "application/json" } });
  assert(response.ok && response.body, `Reference request failed (${response.status})`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      assert(size <= 8 * 1024 * 1024, "Reference response exceeds the bounded metadata request");
      parts.push(part.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(parts);
}

async function acquire(cacheDirectory: string) {
  assert(path.isAbsolute(cacheDirectory), "Use an absolute cache directory outside the checkout");
  await fs.mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const cacheRoot = await fs.realpath(cacheDirectory), checkoutRoot = await fs.realpath(ROOT);
  assert(cacheRoot !== checkoutRoot && !cacheRoot.startsWith(checkoutRoot + path.sep));
  const before = JSON.parse(Buffer.from(await fetchBounded(`${API}/info/data?content-type=application/json`)).toString());
  const releaseFile = path.join(cacheDirectory, "release.json");
  try { assert.deepEqual(JSON.parse(await fs.readFile(releaseFile, "utf8")), before, "Cached metadata belongs to a different release"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.writeFile(releaseFile, JSON.stringify(before), { flag: "wx", mode: 0o600 });
  }
  const sizes = (await fs.readFile(path.join(ROOT, "public/genomes/hg38.chrom.sizes"), "utf8")).trim().split("\n")
    .map(line => line.split(/\s+/)).filter(([name]) => /^chr([1-9]|1[0-9]|2[0-2])$/.test(name));
  const requests = sizes.flatMap(([name, length]) => Array.from({ length: 10 }, (_, index) => {
    const chrom = Number(name.slice(3));
    const midpoint = Math.floor(Number(length) * (index + 1) / 11);
    const start = midpoint - 499_999, end = midpoint + 500_000;
    return { chrom, start, end, url: `${API}/overlap/region/human/${chrom}:${start}-${end}?feature=variation;variant_set=all_chips;content-type=application/json` };
  }));
  assert.equal(requests.length, 220);
  const records: Point[] = [];
  const sources: { url: string; sha256: string; records: number; retrievedAt: string }[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < requests.length) {
      const request = requests[next++];
      const filename = path.join(cacheDirectory, `${sha(request.url)}.json`);
      let bytes: Uint8Array;
      try { bytes = await fs.readFile(filename); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        bytes = await fetchBounded(request.url);
        await fs.writeFile(filename, bytes, { flag: "wx", mode: 0o600 });
      }
      const data = JSON.parse(Buffer.from(bytes).toString()) as Record<string, unknown>[];
      assert(Array.isArray(data) && data.length <= 20_000);
      sources.push({ url: request.url, sha256: sha(bytes), records: data.length,
        retrievedAt: (await fs.stat(filename)).mtime.toISOString() });
      for (const item of data) {
        assert(item.assembly_name === "GRCh38" && item.seq_region_name === String(request.chrom) && item.feature_type === "variation");
        if (item.start !== item.end || typeof item.id !== "string" || !/^rs[1-9][0-9]*$/.test(item.id)) continue;
        if (!Array.isArray(item.alleles) || item.alleles.length < 2 || !item.alleles.every(allele => typeof allele === "string" && /^[ACGT]$/.test(allele))) continue;
        assert(Number.isSafeInteger(item.start) && Number(item.start) >= request.start && Number(item.start) <= request.end);
        records.push({ rsid: Number(item.id.slice(2)), chrom: request.chrom, pos38: Number(item.start) });
      }
      if (sources.length % 20 === 0) console.log(`Reference metadata: ${sources.length}/${requests.length} windows`);
    }
  }));
  const after = JSON.parse(Buffer.from(await fetchBounded(`${API}/info/data?content-type=application/json`)).toString());
  assert.deepEqual(before, after, "Reference release changed during acquisition");
  const chain = await fs.readFile(path.join(ROOT, "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
  const inverse = inverseChain(chain);
  const count = (values: string[]) => {
    const result = new Map<string, number>();
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  };
  const rsids = count(records.map(item => String(item.rsid)));
  const candidates = records.flatMap(item => {
    const pos37 = inverse(item.chrom, item.pos38);
    return pos37 !== null && pos37 !== item.pos38 && rsids.get(String(item.rsid)) === 1
      ? [[item.rsid, item.chrom, pos37, item.pos38]] : [];
  });
  // A coordinate may not name another reference marker or the other build.
  const coordinates = count(candidates.flatMap(item => [`${item[1]}:${item[2]}`, `${item[1]}:${item[3]}`]));
  const sites = candidates.filter(item => coordinates.get(`${item[1]}:${item[2]}`) === 1 && coordinates.get(`${item[1]}:${item[3]}`) === 1)
    .sort((a, b) => a[1] - b[1] || a[3] - b[3] || a[0] - b[0]);
  assert(sites.length >= 1000 && sites.length <= 250_000);
  assert.equal(new Set(sites.map(item => item[1])).size, 22);
  const output = '{\n  "schemaVersion": 1,\n  "columns": ["rsid", "chrom", "pos37", "pos38"],\n  "sites": [\n'
    + sites.map(item => `    ${JSON.stringify(item)}`).join(',\n') + '\n  ]\n}\n';
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), ensemblRelease: before,
    scope: "Public variant coordinate metadata only; no participant or reference-sample genotypes.",
    chainSha256: sha(chain), referenceSha256: sha(output), sites: sites.length,
    candidateSnps: records.length, uniquelyMappedDiscriminatingCandidates: candidates.length,
    selection: "Ten evenly spaced 1 Mb windows per autosome; all_chips SNPs; unique rsIDs and one-to-one same-autosome chain inverses; exclude equal-build positions and every cross-site or cross-build coordinate collision.",
    sources: sources.sort((a, b) => a.url.localeCompare(b.url)) };
  await fs.writeFile(path.join(ROOT, "data/ref/build-discriminating-sites.json"), output);
  await fs.writeFile(path.join(ROOT, "data/ref/build-discriminating-sites.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Reference complete: ${sites.length} coordinate pairs across 22 autosomes`);
}

export async function verifyReference(root = ROOT): Promise<void> {
  const bytes = await fs.readFile(path.join(root, "data/ref/build-discriminating-sites.json"));
  const reference = JSON.parse(bytes.toString()) as { schemaVersion: number; columns: string[]; sites: number[][] };
  const manifest = JSON.parse(await fs.readFile(path.join(root, "data/ref/build-discriminating-sites.manifest.json"), "utf8"));
  const chain = await fs.readFile(path.join(root, "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
  assert.equal(sha(bytes), manifest.referenceSha256);
  assert.equal(sha(chain), manifest.chainSha256);
  assert.equal(manifest.sites, reference.sites.length);
  assert.equal(reference.schemaVersion, 1);
  assert.deepEqual(reference.columns, ["rsid", "chrom", "pos37", "pos38"]);
  assert(reference.sites.length >= 1000 && reference.sites.length <= 250_000);
  assert.equal(manifest.sources.length, 220);
  assert.equal(new Set(manifest.sources.map((source: { url: string }) => source.url)).size, 220);
  const inverse = inverseChain(chain);
  const ids = new Set<number>(), coordinates = new Set<string>(), chromosomes = new Set<number>();
  for (const site of reference.sites) {
    const [rsid, chrom, pos37, pos38] = site;
    assert(site.length === 4 && site.every(value => Number.isSafeInteger(value) && value > 0));
    assert(chrom <= 22 && !ids.has(rsid) && pos37 !== pos38);
    ids.add(rsid); chromosomes.add(chrom);
    assert.equal(inverse(chrom, pos38), pos37);
    for (const position of [pos37, pos38]) {
      const key = `${chrom}:${position}`;
      assert(!coordinates.has(key)); coordinates.add(key);
    }
  }
  assert.equal(chromosomes.size, 22);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const check = process.argv.length === 3 && process.argv[2] === "--check";
  assert(check || (process.argv.length === 4 && process.argv[2] === "--fetch"), "Usage: --check | --fetch /absolute/external/cache");
  void (check ? verifyReference().then(() => console.log("Reference metadata and chain pairs verified")) : acquire(process.argv[3])).catch(error => {
    console.error(error instanceof Error ? error.message : "Reference acquisition failed");
    process.exitCode = 1;
  });
}
