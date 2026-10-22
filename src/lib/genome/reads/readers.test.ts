import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMatrix } from "../../../../scripts/generate-read-calling-fixtures";
import { ByteReader, crc32, itf8Bytes, ltf8Bytes, ReadFileError } from "./binary";
import { blobChunks } from "./bgzf";
import { openBam } from "./bam";
import { openCram, type ReferenceLookup } from "./cram";
import { parseFasta, referenceLookup } from "./fasta";
import { CIGAR_OPS, type AlignedRead } from "./alignment";

/**
 * The BAM and CRAM readers against two independent sources of truth: the
 * planted reads the generator wrote, and htslib's own reading of the files
 * htslib wrote (`fixtures/htslib/`). Every byte here is invented.
 */

const FIXTURES = "src/lib/genome/reads/fixtures";
const bytes = (name: string) => new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
const blob = (name: string) => new Blob([bytes(name) as BlobPart]);
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const cigarString = (cigar: readonly number[]) => cigar.map((op) => `${op >>> 4}${CIGAR_OPS[op & 0xf]}`).join("");

/** The same record dump `fixtures/htslib/recipe.py` hashes. */
function dumpLine(read: AlignedRead): string {
  return [read.name, read.flag, read.refId, read.pos, read.mapq, cigarString(read.cigar), read.seq, [...read.qual].join(",")].join("|");
}
async function dump(records: AsyncIterable<AlignedRead>): Promise<string[]> {
  const lines: string[] = [];
  for await (const read of records) lines.push(dumpLine(read));
  return lines;
}
const planted = () => buildMatrix().reads.map((read) => [read.name, read.flag, read.refId, read.pos0, read.mapq,
  read.cigar.map(([op, length]) => `${length}${op}`).join(""), read.seq, read.qual.join(",")].join("|"));

async function openCramWith(name: string, fasta: Uint8Array | null) {
  const genome = fasta ? await parseFasta(fasta) : null;
  let lookup: ReferenceLookup | null = null;
  const file = await openCram(blobChunks(blob(name)), (reference) => lookup?.(reference) ?? null);
  if (genome) lookup = referenceLookup(genome, file.header.references);
  return file;
}
async function failure(work: () => Promise<unknown>): Promise<string> {
  try { await work(); } catch (error) { return error instanceof ReadFileError ? error.code : `other: ${String(error)}`; }
  return "no error";
}

describe("byte helpers", () => {
  it("computes the IEEE CRC-32 check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round-trips ITF8 and LTF8 at every width, including negative ITF8", () => {
    for (const value of [0, 1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 2147483647, -1, -2147483648]) {
      expect(new ByteReader(Uint8Array.from(itf8Bytes(value))).itf8()).toBe(value);
    }
    for (const value of [0, 127, 128, 16384, 2097152, 268435456, 2 ** 34 + 5]) {
      expect(new ByteReader(Uint8Array.from(ltf8Bytes(value))).ltf8()).toBe(value);
    }
  });
});

describe("the invented matrix files", () => {
  it("BAM: every record equals the planted read", async () => {
    const file = await openBam(blobChunks(blob("synthetic-matrix.bam")));
    expect(file.header.references.map((reference) => [reference.name, reference.length, reference.assembly]))
      .toEqual([["chr20", 1500, "synthetic-reference-v1"], ["chr21", 1500, "synthetic-reference-v1"], ["chr22", 1500, "synthetic-reference-v1"]]);
    expect(await dump(file.records)).toEqual(planted());
  });

  it("CRAM: rebuilt against its reference, every record equals the planted read", async () => {
    const file = await openCramWith("synthetic-matrix.cram", bytes("synthetic-reference.fa"));
    expect(await dump(file.records)).toEqual(planted());
  });

  it("CRAM: refuses to rebuild reads without the reference, or against a different one", async () => {
    expect(await failure(async () => dump((await openCramWith("synthetic-matrix.cram", null)).records))).toBe("reference_required");
    const changed = new TextDecoder().decode(bytes("synthetic-reference.fa")).replace(/\n([ACGT])/, (_, letter: string) =>
      `\n${letter === "A" ? "C" : "A"}`);
    expect(await failure(() => openCramWith("synthetic-matrix.cram", new TextEncoder().encode(changed)))).toBe("reference_mismatch");
  });

  it("refuses a truncated BAM and a CRAM whose block checksum is wrong", async () => {
    const bam = bytes("synthetic-matrix.bam");
    expect(await failure(async () => dump((await openBam(blobChunks(new Blob([bam.subarray(0, bam.length - 100) as BlobPart])))).records)))
      .toBe("unreadable_reads");
    const cram = bytes("synthetic-matrix.cram").slice();
    cram[cram.length - 200] ^= 0xff;
    const genome = await parseFasta(bytes("synthetic-reference.fa"));
    expect(await failure(async () => {
      let lookup: ReferenceLookup | null = null;
      const file = await openCram(blobChunks(new Blob([cram as BlobPart])), (reference) => lookup?.(reference) ?? null);
      lookup = referenceLookup(genome, file.header.references);
      await dump(file.records);
    })).toBe("unreadable_reads");
  });
});

describe("files written by htslib (an independent implementation)", () => {
  const receipt = JSON.parse(readFileSync(`${FIXTURES}/htslib/htslib-cross-check.json`, "utf8")) as {
    writer: { tool: string; htslib: string };
    files: Record<string, { format: string; sha256: string; bytes: number; records: number; recordDumpSha256: string }>;
  };

  it("pins the exact files the receipt describes", () => {
    expect(receipt.writer).toMatchObject({ tool: "pysam 0.24.1 from PyPI", htslib: "1.24" });
    for (const [name, file] of Object.entries(receipt.files)) {
      const data = bytes(`htslib/${name}`);
      expect([name, data.length, sha256(data)]).toEqual([name, file.bytes, file.sha256]);
    }
  });

  it("reads htslib's BAM, CRAM 3.0 with gzip and rANS order 0, and CRAM 3.0 with rANS order 1, exactly as htslib does", async () => {
    for (const name of ["htslib-matrix.bam", "htslib-matrix-3.0.cram", "htslib-qualities-3.0.cram"]) {
      const file = name.endsWith(".bam") ? await openBam(blobChunks(blob(`htslib/${name}`)))
        : await openCramWith(`htslib/${name}`, bytes("synthetic-reference.fa"));
      const lines = await dump(file.records);
      expect([name, lines.length, sha256(lines.join("\n"))])
        .toEqual([name, receipt.files[name].records, receipt.files[name].recordDumpSha256]);
    }
    // The matrix copies decode to the planted reads themselves.
    const matrix = await openCramWith("htslib/htslib-matrix-3.0.cram", bytes("synthetic-reference.fa"));
    expect(await dump(matrix.records)).toEqual(planted());
  });

  it("refuses CRAM 3.1's newer codecs by name instead of guessing", async () => {
    expect(await failure(async () => dump((await openCramWith("htslib/htslib-matrix-3.1.cram", bytes("synthetic-reference.fa"))).records)))
      .toBe("unsupported_compression");
  });
});
