/**
 * Deterministic synthetic single-sample GRCh38 VCF generator, shaped like an
 * ordinary germline whole-genome export, for capacity measurement only.
 *
 * No real genome, no real person and no customer file is involved: every
 * position, allele and depth here comes from the seeded generator below, so a
 * given seed and record count always produce byte-identical output. It exists
 * because measuring the upload boundary needs a file of representative size
 * and line shape, not a representative *person*.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/synthetic-wgs-fixture.mts \
 *     --records 1000000 --out /tmp/fixture.vcf.gz [--seed 1] [--plain]
 */
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/** GRCh38 primary assembly lengths, so positions stay inside real contigs. */
const CONTIGS: ReadonlyArray<readonly [string, number]> = [
  ["chr1", 248956422], ["chr2", 242193529], ["chr3", 198295559], ["chr4", 190214555],
  ["chr5", 181538259], ["chr6", 170805979], ["chr7", 159345973], ["chr8", 145138636],
  ["chr9", 138394717], ["chr10", 133797422], ["chr11", 135086622], ["chr12", 133275309],
  ["chr13", 114364328], ["chr14", 107043718], ["chr15", 101991189], ["chr16", 90338345],
  ["chr17", 83257441], ["chr18", 80373285], ["chr19", 58617616], ["chr20", 64444167],
  ["chr21", 46709983], ["chr22", 50818468], ["chrX", 156040895], ["chrY", 57227415],
];
const BASES = "ACGT";
const GENOTYPES = ["0/1", "1/1", "0|1", "1|0", "1|1"];

/** Small deterministic PRNG: the same seed must reproduce the same bytes. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function* syntheticVcfLines(records: number, seed = 1): Generator<string> {
  const random = mulberry32(seed);
  yield "##fileformat=VCFv4.2\n";
  yield "##source=SyntheticInheritCapacityFixture\n";
  yield '##FILTER=<ID=PASS,Description="All filters passed">\n';
  yield '##INFO=<ID=AC,Number=A,Type=Integer,Description="Allele count in genotypes">\n';
  yield '##INFO=<ID=AF,Number=A,Type=Float,Description="Allele frequency">\n';
  yield '##INFO=<ID=DP,Number=1,Type=Integer,Description="Approximate read depth">\n';
  yield '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">\n';
  yield '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths">\n';
  yield '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read depth">\n';
  yield '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">\n';
  yield '##FORMAT=<ID=PL,Number=G,Type=Integer,Description="Phred-scaled likelihoods">\n';
  for (const [name, length] of CONTIGS) yield `##contig=<ID=${name},length=${length}>\n`;
  yield "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_SAMPLE\n";

  // Real callers emit quantised values from a small vocabulary, which is why a
  // VCF.gz compresses an order of magnitude better than random text would.
  // Drawing each field from a small pool reproduces that redundancy, so the
  // stored size per record lands in the right range as well as the decoded one.
  const qualities = Array.from({ length: 48 }, (_, i) => (30 + i * 61).toFixed(1));
  const frequencies = Array.from({ length: 16 }, (_, i) => (i / 32).toFixed(4));
  const mappings = Array.from({ length: 12 }, (_, i) => (40 + i * 1.7).toFixed(2));
  const strandBias = Array.from({ length: 12 }, (_, i) => (i * 0.5).toFixed(3));
  const oddsRatios = Array.from({ length: 12 }, (_, i) => (i * 0.27).toFixed(3));
  const likelihoods = Array.from({ length: 24 }, (_, i) => `${i * 37},0,${i * 41 + 90}`);
  const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(random() * pool.length)]!;

  // Positions ascend within each contig, as a sorted caller emits them.
  let contig = 0, position = 0;
  const perContig = Math.max(1, Math.floor(records / CONTIGS.length));
  for (let index = 0; index < records; index += 1) {
    if (index > 0 && index % perContig === 0 && contig < CONTIGS.length - 1) { contig += 1; position = 0; }
    position += 1 + Math.floor(random() * 400);
    const [name, length] = CONTIGS[contig]!;
    if (position >= length) position = length - 1;
    const reference = BASES[Math.floor(random() * 4)]!;
    let alternate = BASES[Math.floor(random() * 4)]!;
    if (alternate === reference) alternate = BASES[(BASES.indexOf(reference) + 1) % 4]!;
    const depth = 12 + Math.floor(random() * 60);
    const referenceDepth = Math.floor(depth * random());
    const alternateDepth = depth - referenceDepth;
    const genotypeQuality = 3 + Math.floor(random() * 96);
    const genotype = pick(GENOTYPES);
    const identifier = random() < 0.55 ? `rs${1000000 + Math.floor(random() * 800000000)}` : ".";
    const filter = random() < 0.86 ? "PASS" : "LowQual";
    yield `${name}\t${position}\t${identifier}\t${reference}\t${alternate}\t${pick(qualities)}\t${filter}\t`
      + `AC=1;AF=${pick(frequencies)};DP=${depth};MQ=${pick(mappings)};`
      + `FS=${pick(strandBias)};SOR=${pick(oddsRatios)}\t`
      + `GT:AD:AF:DP:F1R2:F2R1:GQ:PL\t${genotype}:${referenceDepth},${alternateDepth}:`
      + `${pick(frequencies)}:${depth}:${referenceDepth >> 1},${alternateDepth >> 1}:`
      + `${referenceDepth >> 1},${alternateDepth >> 1}:${genotypeQuality}:${pick(likelihoods)}\n`;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const records = Number(value("--records") ?? 100000);
  const seed = Number(value("--seed") ?? 1);
  const out = value("--out");
  const plain = argv.includes("--plain");
  if (!out || !Number.isSafeInteger(records) || records <= 0) {
    console.error("usage: --records <n> --out <path> [--seed <n>] [--plain]");
    process.exit(2);
  }
  const source = Readable.from(syntheticVcfLines(records, seed), { objectMode: false });
  const sink = createWriteStream(out);
  await (plain ? pipeline(source, sink) : pipeline(source, createGzip({ level: 6 }), sink));
  const { size } = await (await import("node:fs/promises")).stat(out);
  console.log(JSON.stringify({ out, records, seed, compressed: !plain, bytes: size }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
