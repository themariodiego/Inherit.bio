/**
 * Invented sequence reads for the targeted read caller (G7.4, ADR 0038). No
 * read, letter or position here comes from a person, a benchmark sample or a
 * real genome: the reference contigs are seeded pseudo-random letters, and
 * every read is copied from them with a planted genotype.
 *
 * Two sets are written:
 *
 * 1. The matrix (`src/lib/genome/reads/fixtures/`): a small invented
 *    reference (three 1,500-letter contigs named chr20, chr21 and chr22, with
 *    the assembly tag `synthetic-reference-v1`), and the same planted reads as
 *    BAM and as CRAM 3.0 against that reference. Each planted position tests
 *    one rule: 0/0, 0/1, 1/1, a second alternate, too few reads, low-quality
 *    and flagged reads that must not count, a position with no reads, paired
 *    reads that count once, a deletion across the position and a fraction
 *    between the bands.
 * 2. The product BAM (`e2e/fixtures/read-calls-product-grch38.bam`): the
 *    GRCh38 sequence dictionary (lengths from `public/genomes/hg38.chrom.sizes`)
 *    and invented reads at four report positions only. Its flanking letters are
 *    invented too; only the four planted letters match the report's stated
 *    reference or alternate.
 *
 * Every byte is deterministic: BGZF members use stored (uncompressed) DEFLATE
 * blocks and CRAM blocks are stored raw, so no zlib version can change them.
 * The receipts pin each file's SHA-256 and the planted truth the unit tests
 * compare against. The planted truth is written from the plan below, never
 * from running the caller.
 *
 * Run: corepack pnpm exec tsx scripts/generate-read-calling-fixtures.ts [--check]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, int32Bytes, itf8Bytes, ltf8Bytes } from "../src/lib/genome/reads/binary";
import { READ_CALLING_THRESHOLDS } from "../src/lib/genome/reads/thresholds";

export const MATRIX_DIRECTORY = "src/lib/genome/reads/fixtures";
export const MATRIX_REFERENCE = `${MATRIX_DIRECTORY}/synthetic-reference.fa`;
export const MATRIX_BAM = `${MATRIX_DIRECTORY}/synthetic-matrix.bam`;
export const MATRIX_CRAM = `${MATRIX_DIRECTORY}/synthetic-matrix.cram`;
export const MATRIX_RECEIPT = `${MATRIX_DIRECTORY}/synthetic-matrix.receipt.json`;
export const PRODUCT_BAM = "e2e/fixtures/read-calls-product-grch38.bam";
export const PRODUCT_RECEIPT = "e2e/fixtures/read-calls-product-grch38.receipt.json";
const GENERATOR = "scripts/generate-read-calling-fixtures.ts";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const md5 = (text: string) => createHash("md5").update(text).digest("hex");

/** mulberry32: a small seeded generator, so every letter is reproducible. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function letters(random: () => number, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += "ACGT"[Math.floor(random() * 4)];
  return out;
}

// ---------------------------------------------------------------------------
// Planted reads
// ---------------------------------------------------------------------------

type CigarOp = "M" | "I" | "D" | "S";
export interface PlantedRead {
  name: string; flag: number; refId: number; pos0: number; mapq: number;
  cigar: [CigarOp, number][]; seq: string; qual: number[];
  mate: { refId: number; pos0: number; tlen: number } | null;
}

export interface PlantedTruth {
  id: string; contig: string; position: number; ref: string; alts: string[];
  state: "called" | "no_call" | "not_covered"; genotype: "0/0" | "0/1" | "1/1" | "./.";
  alt: string; depth: number; refCount: number; altCount: number; otherCount: number;
  overlapping: number; reason: "low_depth" | "other_letters" | "between_bands" | null; rsid: number | null;
}

const READ_LENGTH = 60;
const QUALITY = 35;

interface ReadShape {
  letter: string; flag?: number; mapq?: number; locusQuality?: number;
  softClip?: number; insertion?: boolean; deletion?: boolean; name?: string; mate?: PlantedRead["mate"];
}

/** One read over `position` (1-based) on `contig`, whose letter there is `letter`. */
function plantRead(contig: { name: string; refId: number; bases: string }, position: number, offset: number,
  shape: ReadShape, name: string, random: () => number): PlantedRead {
  const locus0 = position - 1;
  const clip = shape.softClip ?? 0;
  const aligned = READ_LENGTH - clip;
  assert(offset >= 0 && offset < aligned, "the read must cover the position");
  const pos0 = locus0 - offset;
  let seq = letters(random, clip);
  const cigar: PlantedRead["cigar"] = clip ? [["S", clip]] : [];
  if (shape.deletion) {
    // The read spans the position with a three-letter deletion that removes it.
    const before = Math.min(offset - 1, aligned - 1);
    assert(before >= 1, "deletion reads need letters before the position");
    seq += contig.bases.slice(pos0, pos0 + before);
    const after = aligned - before;
    seq += contig.bases.slice(pos0 + before + 3, pos0 + before + 3 + after);
    cigar.push(["M", before], ["D", 3], ["M", after]);
  } else if (shape.insertion && offset > 12) {
    // Two inserted letters well before the position, so it still aligns.
    const before = 6;
    const reference = contig.bases.slice(pos0, pos0 + aligned - 2);
    seq += reference.slice(0, before) + "TT" + reference.slice(before);
    cigar.push(["M", before], ["I", 2], ["M", aligned - 2 - before]);
    const at = clip + before + 2 + (offset - before);
    seq = seq.slice(0, at) + shape.letter + seq.slice(at + 1);
  } else {
    const reference = contig.bases.slice(pos0, pos0 + aligned);
    seq += reference.slice(0, offset) + shape.letter + reference.slice(offset + 1);
    cigar.push(["M", aligned]);
  }
  assert.equal(seq.length, READ_LENGTH);
  const qual = new Array(READ_LENGTH).fill(QUALITY);
  if (shape.locusQuality !== undefined && !shape.deletion) qual[clip + offset + (shape.insertion && offset > 12 ? 2 : 0)] = shape.locusQuality;
  return { name: shape.name ?? name, flag: shape.flag ?? 0, refId: contig.refId, pos0, mapq: shape.mapq ?? 60,
    cigar, seq, qual, mate: shape.mate ?? null };
}

interface PlannedLocus {
  id: string; contig: number; position: number; alts: string[]; rsid: number | null;
  shapes: (ref: string, alts: string[]) => ReadShape[];
  truth: Omit<PlantedTruth, "id" | "contig" | "position" | "ref" | "alts" | "alt" | "rsid"> & { alt?: string };
}

const repeat = (count: number, shape: ReadShape): ReadShape[] => Array.from({ length: count }, () => ({ ...shape }));

/** The matrix: one rule per position, with the outcome each one must produce. */
function matrixPlan(): PlannedLocus[] {
  const t = READ_CALLING_THRESHOLDS;
  assert.equal(t.minimumDepth, 10, "the matrix depths assume the registered minimum depth");
  return [
    { id: "hom_ref", contig: 0, position: 250, alts: ["*"], rsid: 900001,
      shapes: (ref) => [...repeat(14, { letter: ref }), ...repeat(3, { letter: ref, softClip: 5 }),
        ...repeat(3, { letter: ref, insertion: true })],
      truth: { state: "called", genotype: "0/0", depth: 20, refCount: 20, altCount: 0, otherCount: 0, overlapping: 20, reason: null } },
    { id: "second_alternate", contig: 0, position: 450, alts: ["*", "*"], rsid: 900002,
      shapes: (ref, alts) => [...repeat(10, { letter: ref }), ...repeat(10, { letter: alts[1], flag: 0x10 })],
      truth: { state: "called", genotype: "0/1", depth: 20, refCount: 10, altCount: 10, otherCount: 0, overlapping: 20, reason: null, alt: "second" } },
    { id: "het", contig: 0, position: 700, alts: ["*"], rsid: 900003,
      shapes: (ref, alts) => [...repeat(12, { letter: ref }), ...repeat(12, { letter: alts[0], flag: 0x10 })],
      truth: { state: "called", genotype: "0/1", depth: 24, refCount: 12, altCount: 12, otherCount: 0, overlapping: 24, reason: null } },
    { id: "hom_alt", contig: 0, position: 1150, alts: ["*"], rsid: 900004,
      shapes: (_ref, alts) => [...repeat(15, { letter: alts[0] }), ...repeat(3, { letter: alts[0], softClip: 8 })],
      truth: { state: "called", genotype: "1/1", depth: 18, refCount: 0, altCount: 18, otherCount: 0, overlapping: 18, reason: null } },
    { id: "low_depth", contig: 1, position: 300, alts: ["*"], rsid: 900005,
      shapes: (ref, alts) => [...repeat(3, { letter: ref }), ...repeat(3, { letter: alts[0] })],
      truth: { state: "no_call", genotype: "./.", depth: 6, refCount: 3, altCount: 3, otherCount: 0, overlapping: 6, reason: "low_depth" } },
    { id: "low_quality_filtered", contig: 1, position: 800, alts: ["*"], rsid: 900006,
      // Fourteen good reference reads. Eleven alternate reads that would make a
      // false 0/1 if any filter were dropped: low base quality, low mapping
      // quality, duplicate, secondary, quality-check failure and supplementary.
      shapes: (ref, alts) => [...repeat(14, { letter: ref }),
        ...repeat(4, { letter: alts[0], locusQuality: 5 }), ...repeat(3, { letter: alts[0], mapq: 3 }),
        ...repeat(1, { letter: alts[0], flag: 0x400 }), ...repeat(1, { letter: alts[0], flag: 0x100 }),
        ...repeat(1, { letter: alts[0], flag: 0x200 }), ...repeat(1, { letter: alts[0], flag: 0x800 })],
      truth: { state: "called", genotype: "0/0", depth: 14, refCount: 14, altCount: 0, otherCount: 0, overlapping: 25, reason: null } },
    { id: "no_reads", contig: 1, position: 1300, alts: ["*"], rsid: 900007,
      shapes: () => [],
      truth: { state: "not_covered", genotype: "./.", depth: 0, refCount: 0, altCount: 0, otherCount: 0, overlapping: 0, reason: null } },
    { id: "paired_fragments", contig: 2, position: 400, alts: ["*"], rsid: 900008,
      // Six fragments whose two reads both cover the position count six, not
      // twelve; one fragment whose reads disagree counts nothing.
      shapes: (ref, alts) => [0, 1, 2, 3, 4, 5, 6].flatMap((fragment) => {
        const first = fragment === 6 ? ref : fragment < 3 ? ref : alts[0];
        const second = fragment === 6 ? alts[0] : first;
        const name = `paired_fragments-f${fragment}`;
        return [{ letter: first, flag: 0x1 | 0x2 | 0x20 | 0x40, name },
          { letter: second, flag: 0x1 | 0x2 | 0x10 | 0x80, name }];
      }),
      truth: { state: "no_call", genotype: "./.", depth: 6, refCount: 3, altCount: 3, otherCount: 0, overlapping: 14, reason: "low_depth" } },
    { id: "deletion_across", contig: 2, position: 900, alts: ["*"], rsid: null,
      shapes: (ref) => [...repeat(10, { letter: ref }), ...repeat(10, { letter: ref, deletion: true })],
      truth: { state: "no_call", genotype: "./.", depth: 20, refCount: 10, altCount: 0, otherCount: 10, overlapping: 20, reason: "other_letters" } },
    { id: "between_bands", contig: 2, position: 1300, alts: ["*"], rsid: 900010,
      shapes: (ref, alts) => [...repeat(17, { letter: ref }), ...repeat(3, { letter: alts[0] })],
      truth: { state: "no_call", genotype: "./.", depth: 20, refCount: 17, altCount: 3, otherCount: 0, overlapping: 20, reason: "between_bands" } },
  ];
}

export interface MatrixFiles {
  reference: { name: string; bases: string; md5: string }[];
  referenceFasta: string;
  reads: PlantedRead[];
  truth: PlantedTruth[];
  headerText: string;
}

export function buildMatrix(): MatrixFiles {
  const random = generator(0x1a2b3c);
  const names = ["chr20", "chr21", "chr22"];
  const reference = names.map((name) => { const bases = letters(random, 1500); return { name, bases, md5: md5(bases) }; });
  const truth: PlantedTruth[] = [];
  const reads: PlantedRead[] = [];
  for (const locus of matrixPlan()) {
    const contig = { name: names[locus.contig], refId: locus.contig, bases: reference[locus.contig].bases };
    const ref = contig.bases[locus.position - 1];
    const others = "ACGT".split("").filter((letter) => letter !== ref);
    const alts = locus.alts.map((_, index) => others[(locus.position + index) % 3]);
    const shapes = locus.shapes(ref, alts);
    shapes.forEach((shape, index) => {
      const fragment = shape.name !== undefined;
      const offset = fragment ? 10 + ((index >> 1) % 7) * 6 + (index % 2 ? 3 : 0) : 8 + (index * 7) % 40;
      const name = `${locus.id}-${String(index).padStart(2, "0")}`;
      const read = plantRead(contig, locus.position, offset, shape, name, random);
      if (fragment) read.mate = { refId: locus.contig, pos0: 0, tlen: 0 };
      reads.push(read);
    });
    const alt = locus.truth.alt === "second" ? alts[1] : alts[0];
    truth.push({ ...locus.truth, alt, id: locus.id, contig: contig.name, position: locus.position, ref, alts, rsid: locus.rsid });
  }
  // Mates point at each other: same contig, the other read's position.
  const byName = new Map<string, PlantedRead[]>();
  for (const read of reads) if (read.mate) byName.set(read.name, [...(byName.get(read.name) ?? []), read]);
  for (const [first, second] of byName.values()) {
    const span = Math.max(first.pos0, second.pos0) + READ_LENGTH - Math.min(first.pos0, second.pos0);
    first.mate = { refId: second.refId, pos0: second.pos0, tlen: first.pos0 <= second.pos0 ? span : -span };
    second.mate = { refId: first.refId, pos0: first.pos0, tlen: -first.mate.tlen };
  }
  reads.sort((a, b) => a.refId - b.refId || a.pos0 - b.pos0 || a.name.localeCompare(b.name) || a.flag - b.flag);
  const headerText = ["@HD\tVN:1.6\tSO:coordinate",
    ...reference.map((contig) => `@SQ\tSN:${contig.name}\tLN:${contig.bases.length}\tM5:${contig.md5}\tAS:synthetic-reference-v1`),
    `@PG\tID:inherit-synthetic\tPN:${GENERATOR}`,
    "@CO\tInvented reads from an invented reference. No person, sample or real genome.", ""].join("\n");
  const referenceFasta = reference.map((contig) => `>${contig.name} invented sequence, not a genome\n`
    + contig.bases.match(/.{1,60}/g)!.join("\n") + "\n").join("");
  return { reference, referenceFasta, reads, truth, headerText };
}

/** The product BAM: GRCh38 names and lengths, reads at four report positions. */
export const PRODUCT_PLAN = [
  { slug: "lactase-persistence-lct-rs4988235", chrom: "chr2", position: 135851076, rsid: 4988235, ref: "G", alt: "A",
    ref_reads: 0, alt_reads: 16, state: "called", genotype: "1/1" },
  { slug: "muscle-composition-actn3-rs1815739", chrom: "chr11", position: 66560624, rsid: 1815739, ref: "C", alt: "T",
    ref_reads: 2, alt_reads: 2, state: "no_call", genotype: "./." },
  { slug: "alcohol-flush-aldh2-rs671", chrom: "chr12", position: 111803962, rsid: 671, ref: "G", alt: "A",
    ref_reads: 14, alt_reads: 0, state: "called", genotype: "0/0" },
  { slug: "caffeine-metabolism-cyp1a2-rs762551", chrom: "chr15", position: 74749576, rsid: 762551, ref: "C", alt: "A",
    ref_reads: 12, alt_reads: 10, state: "called", genotype: "0/1" },
] as const;

export function buildProduct(root: string): { headerText: string; references: { name: string; length: number }[]; reads: PlantedRead[] } {
  const sizes = readFileSync(path.join(root, "public/genomes/hg38.chrom.sizes"), "utf8").trim().split("\n")
    .map((line) => line.split("\t")).map(([name, length]) => ({ name, length: Number(length) }));
  assert.equal(sizes[0].name, "chr1");
  assert.equal(sizes[0].length, 248956422);
  const random = generator(0x5eed42);
  const reads: PlantedRead[] = [];
  for (const locus of PRODUCT_PLAN) {
    const refId = sizes.findIndex((size) => size.name === locus.chrom);
    assert(refId >= 0);
    // Invented flanking letters around the one stated report letter.
    const start0 = locus.position - 1 - 100;
    const window = letters(random, 100) + locus.ref + letters(random, 100);
    const total = locus.ref_reads + locus.alt_reads;
    for (let index = 0; index < total; index++) {
      const letter = index < locus.ref_reads ? locus.ref : locus.alt;
      const offset = 8 + (index * 7) % 40;
      const pos0 = locus.position - 1 - offset;
      const local = pos0 - start0;
      const seq = window.slice(local, local + offset) + letter + window.slice(local + offset + 1, local + READ_LENGTH);
      assert.equal(seq.length, READ_LENGTH);
      reads.push({ name: `${locus.slug}-${String(index).padStart(2, "0")}`, flag: index % 2 ? 0x10 : 0, refId, pos0, mapq: 60,
        cigar: [["M", READ_LENGTH]], seq, qual: new Array(READ_LENGTH).fill(QUALITY), mate: null });
    }
  }
  reads.sort((a, b) => a.refId - b.refId || a.pos0 - b.pos0 || a.name.localeCompare(b.name));
  const headerText = ["@HD\tVN:1.6\tSO:coordinate",
    ...sizes.map((size) => `@SQ\tSN:${size.name}\tLN:${size.length}\tAS:GRCh38`),
    `@PG\tID:inherit-synthetic\tPN:${GENERATOR}`,
    "@CO\tInvented reads at four report positions. No person, sample or real genome.", ""].join("\n");
  return { headerText, references: sizes, reads };
}

// ---------------------------------------------------------------------------
// BAM (SAM/BAM specification section 4)
// ---------------------------------------------------------------------------

const CIGAR_CODE: Record<CigarOp, number> = { M: 0, I: 1, D: 2, S: 4 };
const SEQ_CODE = "=ACMGRSVTWYHKDBN";

function referenceSpan(cigar: PlantedRead["cigar"]): number {
  return cigar.reduce((sum, [op, length]) => sum + (op === "M" || op === "D" ? length : 0), 0);
}

function reg2bin(beg: number, end: number): number {
  end--;
  if (beg >> 14 === end >> 14) return ((1 << 15) - 1) / 7 + (beg >> 14);
  if (beg >> 17 === end >> 17) return ((1 << 12) - 1) / 7 + (beg >> 17);
  if (beg >> 20 === end >> 20) return ((1 << 9) - 1) / 7 + (beg >> 20);
  if (beg >> 23 === end >> 23) return ((1 << 6) - 1) / 7 + (beg >> 23);
  if (beg >> 26 === end >> 26) return ((1 << 3) - 1) / 7 + (beg >> 26);
  return 0;
}

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const ascii = (text: string) => [...Buffer.from(text, "latin1")];

function bamRecord(read: PlantedRead): number[] {
  const name = ascii(read.name).concat(0);
  const end = read.pos0 + referenceSpan(read.cigar);
  const body = [
    ...int32Bytes(read.refId), ...int32Bytes(read.pos0), name.length, read.mapq, ...u16(reg2bin(read.pos0, end)),
    ...u16(read.cigar.length), ...u16(read.flag), ...int32Bytes(read.seq.length),
    ...int32Bytes(read.mate?.refId ?? -1), ...int32Bytes(read.mate?.pos0 ?? -1), ...int32Bytes(read.mate?.tlen ?? 0),
    ...name,
  ];
  for (const [op, length] of read.cigar) body.push(...int32Bytes((length << 4) | CIGAR_CODE[op]));
  for (let i = 0; i < read.seq.length; i += 2) {
    const high = SEQ_CODE.indexOf(read.seq[i]);
    const low = i + 1 < read.seq.length ? SEQ_CODE.indexOf(read.seq[i + 1]) : 0;
    body.push((high << 4) | low);
  }
  body.push(...read.qual);
  return [...int32Bytes(body.length), ...body];
}

/** One BGZF member around a stored (BTYPE 00) DEFLATE block. */
function bgzfMember(payload: Uint8Array): number[] {
  assert(payload.length <= 65280);
  const cdata = [0x01, ...u16(payload.length), ...u16(~payload.length & 0xffff), ...payload];
  const size = 18 + cdata.length + 8;
  return [0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 0xff, 6, 0, 0x42, 0x43, 2, 0, ...u16(size - 1), ...cdata,
    ...int32Bytes(crc32(payload)), ...int32Bytes(payload.length)];
}
/** The standard empty BGZF member that marks the end of a BAM file. */
const BGZF_EOF = [0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 0xff, 6, 0, 0x42, 0x43, 2, 0, 0x1b, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function writeBam(headerText: string, references: { name: string; length: number }[], reads: PlantedRead[]): Uint8Array {
  const raw: number[] = [0x42, 0x41, 0x4d, 1, ...int32Bytes(headerText.length), ...ascii(headerText),
    ...int32Bytes(references.length)];
  for (const reference of references) {
    raw.push(...int32Bytes(reference.name.length + 1), ...ascii(reference.name), 0, ...int32Bytes(reference.length));
  }
  for (const read of reads) raw.push(...bamRecord(read));
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 65280) out.push(...bgzfMember(Uint8Array.from(raw.slice(i, i + 65280))));
  out.push(...BGZF_EOF);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// CRAM 3.0 (CRAM format specification sections 6 to 10), raw blocks only
// ---------------------------------------------------------------------------

const SERIES: [string, number][] = [["BF", 1], ["CF", 2], ["RL", 3], ["AP", 4], ["RG", 5], ["MF", 7], ["NS", 8],
  ["NP", 9], ["TS", 10], ["TL", 11], ["FN", 12], ["FC", 13], ["FP", 14], ["BS", 15], ["DL", 16], ["MQ", 19],
  ["QS", 20], ["BA", 21]];
const STOP_SERIES: [string, number][] = [["RN", 6], ["IN", 17], ["SC", 18]];

function cramBlock(contentType: number, contentId: number, data: number[]): number[] {
  const head = [0, contentType, ...itf8Bytes(contentId), ...itf8Bytes(data.length), ...itf8Bytes(data.length), ...data];
  return [...head, ...int32Bytes(crc32(Uint8Array.from(head)))];
}

function cramContainer(fields: { refId: number; start: number; span: number; records: number; counter: number;
  bases: number; blocks: number; landmarks: number[] }, data: number[]): number[] {
  const head = [...int32Bytes(data.length), ...itf8Bytes(fields.refId), ...itf8Bytes(fields.start),
    ...itf8Bytes(fields.span), ...itf8Bytes(fields.records), ...ltf8Bytes(fields.counter), ...ltf8Bytes(fields.bases),
    ...itf8Bytes(fields.blocks), ...itf8Bytes(fields.landmarks.length), ...fields.landmarks.flatMap(itf8Bytes)];
  return [...head, ...int32Bytes(crc32(Uint8Array.from(head))), ...data];
}

/** The fixed CRAM 3.0 end-of-file container (specification section 9). */
export const CRAM_EOF = [0x0f, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xe0, 0x45, 0x4f, 0x46, 0, 0, 0, 0, 1, 0,
  0x05, 0xbd, 0xd9, 0x4f, 0, 1, 0, 6, 6, 1, 0, 1, 0, 1, 0, 0xee, 0x63, 0x01, 0x4b];

function compressionHeader(): number[] {
  const preservation = [...ascii("RN"), 1, ...ascii("AP"), 1, ...ascii("RR"), 1,
    ...ascii("SM"), 0x1b, 0x1b, 0x1b, 0x1b, 0x1b, ...ascii("TD"), ...itf8Bytes(1), 0];
  const series: number[] = [];
  for (const [key, id] of SERIES) {
    const params = itf8Bytes(id);
    series.push(...ascii(key), ...itf8Bytes(1), ...itf8Bytes(params.length), ...params);
  }
  for (const [key, id] of STOP_SERIES) {
    const params = [0, ...itf8Bytes(id)];
    series.push(...ascii(key), ...itf8Bytes(5), ...itf8Bytes(params.length), ...params);
  }
  const map = (entries: number, body: number[]) => {
    const inner = [...itf8Bytes(entries), ...body];
    return [...itf8Bytes(inner.length), ...inner];
  };
  return [...map(5, preservation), ...map(SERIES.length + STOP_SERIES.length, series), ...map(0, [])];
}

export function writeCram(headerText: string, reference: { name: string; bases: string }[], reads: PlantedRead[]): Uint8Array {
  const out: number[] = [...ascii("CRAM"), 3, 0, ...ascii("inherit-synthetic".padEnd(20, "\0"))];
  const text = [...int32Bytes(headerText.length), ...ascii(headerText)];
  out.push(...cramContainer({ refId: 0, start: 0, span: 0, records: 0, counter: 0, bases: 0, blocks: 1, landmarks: [] },
    cramBlock(0, 0, text)));
  let counter = 0;
  reference.forEach((contig, refId) => {
    const here = reads.filter((read) => read.refId === refId);
    if (!here.length) return;
    const start = Math.min(...here.map((read) => read.pos0)) + 1;
    const end = Math.max(...here.map((read) => read.pos0 + referenceSpan(read.cigar)));
    const span = end - (start - 1);
    const bases = here.reduce((sum, read) => sum + read.seq.length, 0);
    const ordered = encodeRecordsInOrder(here, contig.bases, start);
    const externalIds = [...ordered.keys()];
    const blocks: number[] = [];
    for (const id of externalIds) blocks.push(...cramBlock(4, id, ordered.get(id)!));
    const core = cramBlock(5, 0, []);
    const sliceHeader = cramBlock(2, 0, [...itf8Bytes(refId), ...itf8Bytes(start), ...itf8Bytes(span),
      ...itf8Bytes(here.length), ...ltf8Bytes(counter), ...itf8Bytes(1 + externalIds.length),
      ...itf8Bytes(externalIds.length), ...externalIds.flatMap(itf8Bytes), ...itf8Bytes(-1),
      ...createHash("md5").update(contig.bases.slice(start - 1, start - 1 + span)).digest()]);
    const header = cramBlock(1, 0, compressionHeader());
    const data = [...header, ...sliceHeader, ...core, ...blocks];
    out.push(...cramContainer({ refId, start, span, records: here.length, counter, bases,
      blocks: 3 + externalIds.length, landmarks: [header.length] }, data));
    counter += here.length;
  });
  out.push(...CRAM_EOF);
  return Uint8Array.from(out);
}

/** Encodes each record's data series in decode order (FN before its features). */
function encodeRecordsInOrder(reads: PlantedRead[], bases: string, start: number): Map<number, number[]> {
  const streams = new Map<number, number[]>([...SERIES, ...STOP_SERIES].sort((a, b) => a[1] - b[1]).map(([, id]) => [id, []]));
  const id = (key: string) => [...SERIES, ...STOP_SERIES].find(([name]) => name === key)![1];
  const put = (key: string, values: number[]) => streams.get(id(key))!.push(...values);
  let previous = start;
  for (const read of reads) {
    put("BF", itf8Bytes(read.flag));
    put("CF", itf8Bytes(0x1 | 0x2));
    put("RL", itf8Bytes(read.seq.length));
    put("AP", itf8Bytes(read.pos0 + 1 - previous)); previous = read.pos0 + 1;
    put("RG", itf8Bytes(-1));
    put("RN", [...ascii(read.name), 0]);
    put("MF", itf8Bytes(read.mate ? (read.flag & 0x20 ? 1 : 0) : 0));
    put("NS", itf8Bytes(read.mate?.refId ?? -1));
    put("NP", itf8Bytes(read.mate ? read.mate.pos0 + 1 : 0));
    put("TS", itf8Bytes(read.mate?.tlen ?? 0));
    put("TL", itf8Bytes(0));
    const features: (() => void)[] = [];
    let readPos = 0, refPos = read.pos0, lastFeature = 0;
    const feature = (code: string, at: number, data: () => void) => {
      const delta = at - lastFeature; lastFeature = at;
      features.push(() => { put("FC", ascii(code)); put("FP", itf8Bytes(delta)); data(); });
    };
    for (const [op, length] of read.cigar) {
      if (op === "M") {
        for (let k = 0; k < length; k++) {
          const base = read.seq[readPos + k], ref = bases[refPos + k];
          if (base !== ref) {
            const others = "ACGTN".split("").filter((letter) => letter !== ref);
            const code = others.indexOf(base);
            feature("X", readPos + k + 1, () => put("BS", [code]));
          }
        }
        readPos += length; refPos += length;
      } else if (op === "S" || op === "I") {
        const run = ascii(read.seq.slice(readPos, readPos + length));
        feature(op, readPos + 1, () => put(op === "S" ? "SC" : "IN", [...run, 0]));
        readPos += length;
      } else {
        const deleted = length;
        feature("D", readPos + 1, () => put("DL", itf8Bytes(deleted)));
        refPos += length;
      }
    }
    put("FN", itf8Bytes(features.length));
    for (const write of features) write();
    put("MQ", itf8Bytes(read.mapq));
    put("QS", read.qual);
  }
  for (const [key, value] of [...streams]) if (!value.length) streams.delete(key);
  return streams;
}

// ---------------------------------------------------------------------------

export interface GeneratedFiles { path: string; bytes: Uint8Array; }

export function generateReadCallingFiles(root: string): GeneratedFiles[] {
  const matrix = buildMatrix();
  const references = matrix.reference.map((contig) => ({ name: contig.name, length: contig.bases.length }));
  const bam = writeBam(matrix.headerText, references, matrix.reads);
  const cram = writeCram(matrix.headerText, matrix.reference, matrix.reads);
  const fasta = Buffer.from(matrix.referenceFasta, "latin1");
  const product = buildProduct(root);
  const productBam = writeBam(product.headerText, product.references, product.reads);
  const matrixReceipt = {
    schemaVersion: 1, generator: GENERATOR, classification: "invented reads from an invented reference; no person, sample or real genome",
    thresholds: READ_CALLING_THRESHOLDS,
    files: {
      [path.basename(MATRIX_REFERENCE)]: { sha256: sha256(fasta), bytes: fasta.length },
      [path.basename(MATRIX_BAM)]: { sha256: sha256(bam), bytes: bam.length },
      [path.basename(MATRIX_CRAM)]: { sha256: sha256(cram), bytes: cram.length },
    },
    contigs: matrix.reference.map((contig) => ({ name: contig.name, length: contig.bases.length, md5: contig.md5 })),
    reads: matrix.reads.length,
    truth: matrix.truth,
  };
  const productReceipt = {
    schemaVersion: 1, generator: GENERATOR, classification: "invented reads at four report positions; no person, sample or real genome",
    file: { name: path.basename(PRODUCT_BAM), sha256: sha256(productBam), bytes: productBam.length },
    reads: product.reads.length,
    planted: PRODUCT_PLAN,
  };
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
  return [
    { path: MATRIX_REFERENCE, bytes: fasta }, { path: MATRIX_BAM, bytes: bam }, { path: MATRIX_CRAM, bytes: cram },
    { path: MATRIX_RECEIPT, bytes: json(matrixReceipt) },
    { path: PRODUCT_BAM, bytes: productBam }, { path: PRODUCT_RECEIPT, bytes: json(productReceipt) },
  ];
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert(process.argv.slice(2).every((argument) => argument === "--check"));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of generateReadCallingFiles(root)) {
    const target = path.join(root, file.path);
    if (process.argv.includes("--check")) {
      assert.equal(sha256(readFileSync(target)), sha256(file.bytes), `${file.path} differs from the generator`);
      console.log(`${file.path}: verified, ${file.bytes.length} bytes`);
    } else {
      writeFileSync(target, file.bytes);
      console.log(`${file.path}: generated, ${file.bytes.length} bytes`);
    }
  }
}
