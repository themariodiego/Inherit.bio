/** Public GIAB reference fixture only. No network, ID annotation or genotype edits.
 * Run: pnpm exec tsx scripts/generate-giab-browser-window.mts [--check]
 * The checked-in parent has the provenance/terms in data/samples/PROVENANCE.md.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseVcf } from "../src/lib/genome/parsers/vcf";
import { countInputLines, emptyReadCounts } from "../src/lib/genome/input-provenance";

assert(process.argv.slice(2).every(arg => arg === "--check"));
const check = process.argv.includes("--check");
const root = new URL("../", import.meta.url);
const parentPath = "data/samples/HG001_GRCh38_chr20-22.vcf.gz";
const fixturePath = "e2e/fixtures/HG001_GRCh38_chr20_1000000-1100000.vcf.gz";
const receiptPath = "e2e/fixtures/HG001_GRCh38_chr20_1000000-1100000.receipt.json";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const parent = readFileSync(new URL(parentPath, root));
assert.equal(sha(parent), "3717fc164ef9137a4eec6a2ab48711f2478881ca55fbb230964764be48a78a83");
const decodedParent = gunzipSync(parent, { maxOutputLength: 100_000_000 });
assert.equal(decodedParent.length, 99_744_915);
const headers: Buffer[] = [], rows: Buffer[] = [];
let offset = 0;
while (offset < decodedParent.length) {
  const end = decodedParent.indexOf(10, offset);
  assert(end >= 0, "Pinned source has complete newline-terminated lines");
  const line = decodedParent.subarray(offset, end + 1);
  offset = end + 1;
  if (line[0] === 35) headers.push(line);
  else {
    const fields = line.toString("utf8").trimEnd().split("\t");
    if (fields[0] === "chr20" && Number(fields[1]) >= 1_000_000 && Number(fields[1]) <= 1_100_000) {
      assert.equal(fields[2], ".", "Benchmark IDs remain absent; never annotate them");
      rows.push(line);
    }
  }
}
assert.equal(rows.length, 144);
const decoded = Buffer.concat([...headers, ...rows]);
assert.equal(decoded.length, 100_410);
assert.equal(sha(decoded), "df10e731541a2286fe04b351847db83c18ce0aed54360df3ee5319a12b6998d9");
// Node gzip uses no filename and an epoch timestamp; the exact committed bytes
// are also checked on regeneration rather than accepting a changed compressor.
const compressed = gzipSync(decoded, { level: 9 });
assert.equal(compressed.readUInt32LE(4), 0);
assert(compressed.length < 65_536 && decoded.length < 52_428_800);
const counts = emptyReadCounts();
async function* lines() { for (const line of decoded.toString("utf8").split("\n")) yield line; }
const parsed = await parseVcf(countInputLines(lines(), "vcf", counts));
assert.deepEqual(counts, { called: 127, noCall: 0, unsupported: 17, failedFilter: 0, blocks: 0, singleSample: true, buildClaim: true });
assert.equal(parsed.records.length, 144);
assert(parsed.records.every(row => row.rsid === null && row.chrom === 20 && row.pos >= 1_000_000 && row.pos <= 1_100_000));
const panel = JSON.parse(readFileSync(new URL("data/ref/aims.json", root), "utf8")) as { chrom: number; pos38: number }[];
const positions = new Set(parsed.records.map(row => `${row.chrom}:${row.pos}`));
const ancestryMarkerCount = panel.filter(marker => positions.has(`${marker.chrom}:${marker.pos38}`)).length;
assert.equal(ancestryMarkerCount, 0, "The bounded GIAB window supplies no positions from the shipped AIM panel");
const firstPoint = parsed.records.find(row => row.ref?.length === 1 && row.alt?.length === 1)!;
assert(firstPoint);
const receipt = {
  kind: "public-reference-benchmark-window", sample: "GIAB HG001 / NA12878", build: "GRCh38",
  source: { path: parentPath, sha256: sha(parent), compressedBytes: parent.length, decodedBytes: decodedParent.length,
    upstreamFile: "HG001_GRCh38_1_22_v4.2.1_benchmark.vcf.gz",
    upstreamSha256: "93bc4c2c696eaf13515ab058caecc064bfed704f85bac7482330ca91bc730daa",
    retrieved: "2026-08-28", provenance: "data/samples/PROVENANCE.md",
    licenseRecord: "docs/dataset-licenses.md — GIAB / NIST HG001 benchmark: public-domain U.S. government data, Use" },
  transformation: "All parent header bytes and all chr20 records at inclusive positions 1000000..1100000, in original order, retained verbatim. No ID annotation or other field changes. Gzip level 9, timestamp zero, no filename.",
  fixture: { path: fixturePath, sha256: sha(compressed), compressedBytes: compressed.length,
    decodedSha256: sha(decoded), decodedBytes: decoded.length, headerBytes: Buffer.concat(headers).length,
    records: rows.length, variants: parsed.records.length, counts, firstPoint, ancestryMarkerCount },
  scope: "Bounded positive benchmark transport/preparation/locus proof. rsID/gene positives use a separate actual synthetic source. Canonical parent lineages remain uncomputed; this does not close A8 MT/Y coverage.",
};
const receiptBytes = JSON.stringify(receipt, null, 2) + "\n";
if (check) {
  assert.deepEqual(readFileSync(new URL(fixturePath, root)), compressed);
  assert.equal(readFileSync(new URL(receiptPath, root), "utf8"), receiptBytes);
} else {
  writeFileSync(new URL(fixturePath, root), compressed);
  writeFileSync(new URL(receiptPath, root), receiptBytes);
}
console.log(`GIAB window ${check ? "verified" : "generated"}: 144 unchanged records, 127 supported calls, ${compressed.length} compressed / ${decoded.length} decoded bytes.`);
