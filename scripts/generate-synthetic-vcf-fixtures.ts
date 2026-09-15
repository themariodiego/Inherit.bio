/** Independently invented parser/transport fixtures; no person's genome is read.
 * Run: corepack pnpm exec tsx scripts/generate-synthetic-vcf-fixtures.ts [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { countInputLines, emptyReadCounts } from "../src/lib/genome/input-provenance";
import { parseVcf } from "../src/lib/genome/parsers/vcf";
import type { ReportTemplate, TemplateVariant } from "../src/lib/genome/reports";

export const BROWSER_FIXTURE = "e2e/fixtures/synthetic-browser-grch38.vcf.gz";
export const PIPELINE_FIXTURE = "data/samples/synthetic-pipeline-grch38.vcf.gz";
export const PIPELINE_FILLER_RECORDS = 120_000;
const GENERATOR = "scripts/generate-synthetic-vcf-fixtures.ts";
const BASES = "ACGT";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function header(label: string): string[] {
  return [
    "##fileformat=VCFv4.2",
    `##source=Inherit deterministic synthetic ${label}; no real person; ${GENERATOR}`,
    "##reference=GRCh38",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC",
  ];
}

function row(chrom: number, pos: number, ref: string, alt: string, gt: string, rsid?: number): string {
  return [`chr${chrom}`, pos, rsid === undefined ? "." : `rs${rsid}`, ref, alt, 50, "PASS", ".", "GT", gt].join("\t");
}

/** Arithmetic positions and cycling letters are invented, not reference-aligned calls. */
export function buildBrowserVcf(): string {
  const lines = header("browser fixture");
  for (let i = 0; i < 144; i++) {
    const ref = BASES[i % 4], alternate = BASES[(i + 1) % 4];
    lines.push(row(20, 1_000_003 + 613 * i, ref, i < 127 ? alternate : ref + alternate,
      i % 3 === 0 ? "1/1" : "0/1"));
  }
  return `${lines.join("\n")}\n`;
}

/** Catalogue metadata is public reference data; every chosen GT is invented here. */
export function pipelineCatalogue(repositoryRoot: string) {
  const variants = new Map<number, TemplateVariant>();
  const sources = readdirSync(path.join(repositoryRoot, "data/templates"))
    .filter(name => name.endsWith(".json")).sort().map(name => {
      const relativePath = `data/templates/${name}`;
      const bytes = readFileSync(path.join(repositoryRoot, relativePath));
      const templates = JSON.parse(bytes.toString("utf8")) as ReportTemplate[];
      for (const template of templates) for (const variant of template.variants) {
        assert(Number.isSafeInteger(variant.rsid) && variant.rsid > 0);
        assert(Number.isSafeInteger(variant.chrom) && variant.chrom >= 1 && variant.chrom <= 25);
        assert(Number.isSafeInteger(variant.pos38) && variant.pos38 > 0);
        assert(/^[ACGT]+$/.test(variant.ref) && /^[ACGT]+$/.test(variant.alt) && variant.ref !== variant.alt);
        const previous = variants.get(variant.rsid);
        if (previous) for (const key of ["chrom", "pos38", "ref", "alt"] as const) {
          assert.equal(previous[key], variant[key], `Conflicting catalogue identity: rs${variant.rsid}`);
        }
        variants.set(variant.rsid, variant);
      }
      return { path: relativePath, sha256: sha256(bytes) };
    });
  assert(variants.size > 1);
  const sorted = [...variants.values()].sort((a, b) => a.rsid - b.rsid);
  return { sources, included: sorted.filter((_, index) => index % 2 === 0),
    absent: sorted.filter((_, index) => index % 2 === 1) };
}

export function buildPipelineVcf(repositoryRoot: string): string {
  const catalogue = pipelineCatalogue(repositoryRoot);
  const rows: { chrom: number; pos: number; text: string }[] = [];
  for (let i = 0; i < PIPELINE_FILLER_RECORDS; i++) {
    const chrom = 20 + Math.floor(i / 40_000), pos = 3_000_001 + 257 * (i % 40_000);
    rows.push({ chrom, pos, text: row(chrom, pos, BASES[i % 4], BASES[(i + 1) % 4],
      i % 3 === 0 ? "1/1" : "0/1") });
  }
  for (const [index, variant] of catalogue.included.entries()) {
    rows.push({ chrom: variant.chrom, pos: variant.pos38,
      text: row(variant.chrom, variant.pos38, variant.ref, variant.alt, index % 2 === 0 ? "0/1" : "1/1", variant.rsid) });
  }
  rows.sort((a, b) => a.chrom - b.chrom || a.pos - b.pos);
  for (let i = 1; i < rows.length; i++) assert(
    rows[i].chrom !== rows[i - 1].chrom || rows[i].pos !== rows[i - 1].pos,
    "Synthetic filler must not collide with a catalogue position",
  );
  return `${[...header("pipeline fixture"), ...rows.map(item => item.text)].join("\n")}\n`;
}

export function compressSyntheticVcf(text: string): Buffer {
  const compressed = gzipSync(text, { level: 9 });
  assert.equal(compressed.readUInt32LE(4), 0, "No gzip timestamp");
  assert.equal(compressed[3], 0, "No optional gzip header fields or header checksum");
  // RFC 1952 OS=255 leaves the origin unspecified. zlib otherwise records
  // its build platform here, changing exact fixture bytes between hosts.
  // With FHCRC absent, this metadata byte changes no checksum or payload.
  compressed[9] = 255;
  return compressed;
}

export async function generateSyntheticVcfFixtures(repositoryRoot: string, check: boolean): Promise<void> {
  const catalogue = pipelineCatalogue(repositoryRoot);
  for (const [fixturePath, text] of [
    [BROWSER_FIXTURE, buildBrowserVcf()], [PIPELINE_FIXTURE, buildPipelineVcf(repositoryRoot)],
  ] as const) {
    const browser = fixturePath === BROWSER_FIXTURE;
    const decoded = Buffer.from(text), compressed = compressSyntheticVcf(text);
    const counts = emptyReadCounts();
    async function* lines() { for (const line of text.split("\n")) yield line; }
    const parsed = await parseVcf(countInputLines(lines(), "vcf", counts));
    assert.equal(parsed.build, "GRCh38");
    assert.equal(parsed.skipped, 0);
    assert.equal(parsed.records.length, browser ? 144 : PIPELINE_FILLER_RECORDS + catalogue.included.length);
    const panel = JSON.parse(readFileSync(path.join(repositoryRoot, "data/ref/aims.json"), "utf8")) as { chrom: number; pos38: number }[];
    const positions = new Set(parsed.records.map(record => `${record.chrom}:${record.pos}`));
    const ancestryMarkerCount = panel.filter(marker => positions.has(`${marker.chrom}:${marker.pos38}`)).length;
    if (browser) {
      assert.deepEqual(counts, { called: 127, noCall: 0, unsupported: 17, failedFilter: 0, blocks: 0, singleSample: true, buildClaim: true });
      assert.equal(ancestryMarkerCount, 0);
      assert(parsed.records.every(record => record.rsid === null && record.chrom === 20 && record.pos >= 1_000_000 && record.pos <= 1_100_000));
      assert.deepEqual(parsed.records[0], { rsid: null, chrom: 20, pos: 1_000_003, ref: "A", alt: "C", genotype: "C/C" });
    } else {
      assert(parsed.records.length > 100_000);
      assert.equal(parsed.records.filter(record => record.rsid !== null).length, catalogue.included.length);
    }
    assert(decoded.length < 52_428_800 && compressed.length < 1_000_000);
    const receipt = {
      kind: "deterministic-synthetic-vcf", build: "GRCh38", generator: GENERATOR,
      source: browser ? "Arithmetic positions and cycling alleles; no source genome or reference sequence is read."
        : "Arithmetic filler plus public report-template positions/alleles; all genotypes are independently invented.",
      transformation: "Gzip level 9, timestamp zero, no optional header fields, OS byte 255 (unspecified). No decoded artifact is written.",
      ...(browser ? {} : { catalogue: { sources: catalogue.sources,
        includedRsids: catalogue.included.map(variant => variant.rsid), absentRsids: catalogue.absent.map(variant => variant.rsid),
        selection: "Sort unique rsIDs ascending; include even zero-based indices, omit odd indices. Alternate included GT 0/1 and 1/1." } }),
      fixture: { path: fixturePath, sha256: sha256(compressed), compressedBytes: compressed.length,
        decodedSha256: sha256(decoded), decodedBytes: decoded.length, records: parsed.records.length,
        counts, firstPoint: parsed.records[0], ancestryMarkerCount },
      scope: browser ? "Synthetic transport/hash/preparation/locus proof, including unsupported calls and zero ancestry/lineage positions. No biological accuracy claim."
        : "Synthetic streaming parser and all-template resolution proof at over 100,000 records. No biological accuracy or hosted capacity claim.",
    };
    const receiptPath = fixturePath.replace(/\.vcf\.gz$/, ".receipt.json");
    const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
    if (check) {
      assert.deepEqual(readFileSync(path.join(repositoryRoot, fixturePath)), compressed);
      assert.equal(readFileSync(path.join(repositoryRoot, receiptPath), "utf8"), receiptBytes);
    } else {
      writeFileSync(path.join(repositoryRoot, fixturePath), compressed);
      writeFileSync(path.join(repositoryRoot, receiptPath), receiptBytes);
    }
    console.log(`${fixturePath}: ${check ? "verified" : "generated"}, ${parsed.records.length} records, ${compressed.length} compressed bytes`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.slice(2).every(argument => argument === "--check"));
  void generateSyntheticVcfFixtures(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), process.argv.includes("--check"));
}
