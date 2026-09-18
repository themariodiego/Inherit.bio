/**
 * Deterministic synthetic single-sample GRCh38 VCF or gVCF generator, shaped
 * like an ordinary germline whole-genome export, for capacity measurement
 * only.
 *
 * No real genome, no real person and no customer file is involved: every
 * position, allele, block span and depth here comes from the seeded generator
 * below, so a given seed, mode and record count always produce byte-identical
 * output. It exists because measuring the upload and preparation boundaries
 * needs a file of representative size and line shape, not a representative
 * *person*.
 *
 * Two shapes:
 *   - VCF (default): one called variant per record.
 *   - gVCF (`--gvcf`): reference blocks (`<NON_REF>` with `END=`) covering the
 *     genome, with one called variant after every fourth block, as a
 *     haplotype caller emits them. The sniffer classifies the file `gvcf` from
 *     the first data row, and the finalizer's validator accepts it under the
 *     declared format `gVCF`, plain or gzip.
 *
 * Two ways to size a file: `--records <n>` (data rows) or `--bytes <n>` (the
 * decoded size the admission ceilings are measured in; generation stops at the
 * first row that reaches it). Both given, the first reached wins.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/synthetic-wgs-fixture.mts \
 *     --out /tmp/fixture.vcf.gz [--records 1000000 | --bytes 2147483648] \
 *     [--gvcf] [--seed 1] [--plain]
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

/** In gVCF mode, one called variant follows every this many reference blocks. */
export const GVCF_BLOCKS_PER_VARIANT = 4;

export interface SyntheticFixtureOptions {
  /** Emit reference blocks with interleaved variants instead of variants only. */
  gvcf?: boolean;
  /** Stop at the first row that brings the decoded size to this many bytes. */
  maximumBytes?: number;
  /** Filled in as the generator runs, for the caller's receipt. */
  stats?: { records: number; bytes: number };
}

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

export function* syntheticVcfLines(records: number, seed = 1, options: SyntheticFixtureOptions = {}): Generator<string> {
  const random = mulberry32(seed);
  const gvcf = options.gvcf === true;
  const maximumBytes = options.maximumBytes ?? Number.POSITIVE_INFINITY;
  const stats = options.stats ?? { records: 0, bytes: 0 };
  stats.records = 0; stats.bytes = 0;
  // Every line is ASCII, so its length is its byte count.
  const emit = (line: string) => { stats.bytes += line.length; return line; };

  yield emit("##fileformat=VCFv4.2\n");
  yield emit(gvcf ? "##source=SyntheticInheritCapacityFixture,gVCF\n" : "##source=SyntheticInheritCapacityFixture\n");
  yield emit('##FILTER=<ID=PASS,Description="All filters passed">\n');
  if (gvcf) {
    yield emit('##ALT=<ID=NON_REF,Description="Represents any possible alternative allele not already represented at this location by REF and ALT">\n');
    yield emit('##INFO=<ID=END,Number=1,Type=Integer,Description="Stop position of the interval">\n');
    yield emit("##GVCFBlock0-20=minGQ=0(inclusive),maxGQ=20(exclusive)\n");
    yield emit("##GVCFBlock20-60=minGQ=20(inclusive),maxGQ=60(exclusive)\n");
    yield emit("##GVCFBlock60-100=minGQ=60(inclusive),maxGQ=100(exclusive)\n");
  }
  yield emit('##INFO=<ID=AC,Number=A,Type=Integer,Description="Allele count in genotypes">\n');
  yield emit('##INFO=<ID=AF,Number=A,Type=Float,Description="Allele frequency">\n');
  yield emit('##INFO=<ID=DP,Number=1,Type=Integer,Description="Approximate read depth">\n');
  yield emit('##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">\n');
  yield emit('##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths">\n');
  yield emit('##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read depth">\n');
  yield emit('##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">\n');
  if (gvcf) yield emit('##FORMAT=<ID=MIN_DP,Number=1,Type=Integer,Description="Minimum DP observed within the GVCF block">\n');
  yield emit('##FORMAT=<ID=PL,Number=G,Type=Integer,Description="Phred-scaled likelihoods">\n');
  for (const [name, length] of CONTIGS) yield emit(`##contig=<ID=${name},length=${length}>\n`);
  yield emit("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_SAMPLE\n");

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
  const blockLikelihoods = Array.from({ length: 24 }, (_, i) => `0,${3 + i * 3},${45 + i * 40}`);
  const pick = <T,>(pool: readonly T[]): T => pool[Math.floor(random() * pool.length)]!;

  // Positions ascend within each contig, as a sorted caller emits them. In
  // gVCF mode the blocks tile the contig: each starts where the last ended.
  // Sized by records, the contigs take equal shares of the rows (the shape
  // every recorded measurement used, kept byte-identical). Sized by bytes, the
  // row count is only an estimate from the bytes per row, so each contig takes
  // a share proportional to its length; a contig that fills up before its
  // share ends hands over early, and when the last one fills the file ends.
  let contig = 0, position = 0;
  const totalLength = CONTIGS.reduce((sum, [, length]) => sum + length, 0);
  const estimated = Number.isFinite(maximumBytes) ? Math.min(records, Math.ceil(maximumBytes / (gvcf ? 92 : 155))) : records;
  const share = (at: number) => Number.isFinite(maximumBytes)
    ? Math.max(1, Math.round(estimated * CONTIGS[at]![1] / totalLength))
    : Math.max(1, Math.floor(estimated / CONTIGS.length));
  let handover = share(0);
  for (let index = 0; index < records && stats.bytes < maximumBytes; index += 1) {
    if (contig < CONTIGS.length - 1 && (index === handover || position >= CONTIGS[contig]![1] - 2048)) {
      contig += 1; position = 0; handover = index + share(contig);
    } else if (position >= CONTIGS[contig]![1] - 2048) {
      break; // the genome is used up; the receipt shows the shortfall
    }
    const [name, length] = CONTIGS[contig]!;

    if (gvcf && (index + 1) % (GVCF_BLOCKS_PER_VARIANT + 1) !== 0) {
      // A reference block: REF is the first base, ALT is only <NON_REF>, INFO
      // carries END, and the genotype is homozygous reference. Never a call.
      // Blocks are short, as GQ banding makes them, and each starts where the
      // previous row ended.
      position += 1;
      if (position >= length) position = length - 1;
      let end = position + Math.floor(random() * 40);
      if (end >= length) end = length - 1;
      const depth = 12 + Math.floor(random() * 60);
      const genotypeQuality = 3 + Math.floor(random() * 96);
      const minimumDepth = Math.max(1, depth - Math.floor(random() * 8));
      yield emit(`${name}\t${position}\t.\t${BASES[Math.floor(random() * 4)]}\t<NON_REF>\t.\t.\tEND=${end}\t`
        + `GT:DP:GQ:MIN_DP:PL\t0/0:${depth}:${genotypeQuality}:${minimumDepth}:${pick(blockLikelihoods)}\n`);
      position = end;
      stats.records += 1;
      continue;
    }

    // A called site: in a VCF the next one is up to 400 bases on; in a gVCF it
    // is the base after the block that ended just before it.
    position += gvcf ? 1 : 1 + Math.floor(random() * 400);
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
    if (gvcf) {
      // A called site inside a gVCF lists <NON_REF> after the observed
      // alternate, and its FORMAT carries the two extra likelihood cells.
      yield emit(`${name}\t${position}\t${identifier}\t${reference}\t${alternate},<NON_REF>\t${pick(qualities)}\t${filter}\t`
        + `AC=1;AF=${pick(frequencies)};DP=${depth};MQ=${pick(mappings)}\t`
        + `GT:AD:DP:GQ:PL\t${genotype}:${referenceDepth},${alternateDepth},0:${depth}:${genotypeQuality}:`
        + `${pick(likelihoods)},${genotypeQuality * 3},${genotypeQuality * 3 + 90},${genotypeQuality * 6}\n`);
    } else {
      yield emit(`${name}\t${position}\t${identifier}\t${reference}\t${alternate}\t${pick(qualities)}\t${filter}\t`
        + `AC=1;AF=${pick(frequencies)};DP=${depth};MQ=${pick(mappings)};`
        + `FS=${pick(strandBias)};SOR=${pick(oddsRatios)}\t`
        + `GT:AD:AF:DP:F1R2:F2R1:GQ:PL\t${genotype}:${referenceDepth},${alternateDepth}:`
        + `${pick(frequencies)}:${depth}:${referenceDepth >> 1},${alternateDepth >> 1}:`
        + `${referenceDepth >> 1},${alternateDepth >> 1}:${genotypeQuality}:${pick(likelihoods)}\n`);
    }
    stats.records += 1;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const bytesFlag = value("--bytes");
  const maximumBytes = bytesFlag === undefined ? undefined : Number(bytesFlag);
  const records = Number(value("--records") ?? (maximumBytes === undefined ? 100000 : Number.MAX_SAFE_INTEGER));
  const seed = Number(value("--seed") ?? 1);
  const out = value("--out");
  const plain = argv.includes("--plain");
  const gvcf = argv.includes("--gvcf");
  const usable = (n: number | undefined) => n === undefined || (Number.isSafeInteger(n) && n > 0);
  if (!out || !usable(records) || !usable(maximumBytes)) {
    console.error("usage: --out <path> [--records <n> | --bytes <n>] [--gvcf] [--seed <n>] [--plain]");
    process.exit(2);
  }
  const stats = { records: 0, bytes: 0 };
  const source = Readable.from(syntheticVcfLines(records, seed, { gvcf, maximumBytes, stats }), { objectMode: false });
  const sink = createWriteStream(out);
  await (plain ? pipeline(source, sink) : pipeline(source, createGzip({ level: 6 }), sink));
  const { size } = await (await import("node:fs/promises")).stat(out);
  console.log(JSON.stringify({ out, format: gvcf ? "gVCF" : plain ? "VCF" : "VCF.GZ", records: stats.records, seed,
    compressed: !plain, bytes: size, decodedBytes: stats.bytes }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
