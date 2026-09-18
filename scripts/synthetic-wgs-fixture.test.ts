import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GVCF_BLOCKS_PER_VARIANT, syntheticVcfLines } from "./synthetic-wgs-fixture.mjs";
import { validateSubjectStructure } from "../src/lib/uploads/subject-structure";
import { sniffHeadV2 } from "../src/lib/genome/parsers/sniff";
import { countInputLines, emptyReadCounts } from "../src/lib/genome/input-provenance";

function text(records: number, seed = 1, options?: Parameters<typeof syntheticVcfLines>[2]) {
  return [...syntheticVcfLines(records, seed, options)].join("");
}
async function chunks(bytes: Buffer) {
  return (async function* () { yield new Uint8Array(bytes); })();
}
async function* lines(body: string) { yield* body.split("\n").filter(Boolean); }
async function drain(iterable: AsyncIterable<unknown>) { for await (const value of iterable) void value; }
function rows(body: string) {
  return body.split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split("\t"));
}

describe("the synthetic capacity fixture", () => {
  it("is byte-identical for a seed, so a measurement can be repeated exactly", () => {
    expect(text(500)).toBe(text(500));
    expect(text(500, 2)).not.toBe(text(500, 1));
    expect(text(500, 1, { gvcf: true })).toBe(text(500, 1, { gvcf: true }));
    expect(text(500, 1, { gvcf: true })).not.toBe(text(500, 1));
  });

  it("emits one single-sample header and the exact ten columns the product requires", () => {
    for (const body of [text(200), text(200, 1, { gvcf: true })]) {
      const all = body.split("\n").filter(Boolean);
      const headers = all.filter(line => line.startsWith("#CHROM"));
      expect(headers).toHaveLength(1);
      expect(headers[0]!.split("\t").slice(0, 9).join("\t"))
        .toBe("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT");
      expect(headers[0]!.split("\t")).toHaveLength(10);
      expect(all.filter(line => line.startsWith("##fileformat="))).toHaveLength(1);
      for (const row of all.filter(line => !line.startsWith("#"))) {
        expect(row.split("\t")).toHaveLength(10);
      }
    }
  });

  it("keeps positions ascending inside each contig, as a sorted caller emits them", () => {
    for (const body of [text(3000), text(3000, 1, { gvcf: true })]) {
      const seen = new Map<string, number>();
      for (const [contig, position] of rows(body)) {
        const at = Number(position);
        expect(at).toBeGreaterThan(0);
        if (seen.has(contig!)) expect(at).toBeGreaterThan(seen.get(contig!)!);
        seen.set(contig!, at);
      }
      expect(seen.size).toBeGreaterThan(1);
    }
  });

  it("still produces the bytes every recorded measurement was made on", () => {
    // The plain 1,000-record output of the generator as it stood when the
    // finalization and preparation capacity tables were measured (seed 1).
    // Changing the VCF shape invalidates those tables; change this digest only
    // together with them.
    expect(createHash("sha256").update(text(1000)).digest("hex"))
      .toBe("4fd5c622f462ea62bcbfd2280db4635b16a21a6aaeaee4096a6ba1325e9321c0");
  });

  it("names no real person and carries no genotype from any real source", () => {
    const body = text(400);
    expect(body).toContain("SYNTHETIC_SAMPLE");
    expect(body).toContain("SyntheticInheritCapacityFixture");
  });

  it("is accepted by the same validator the finalizer runs, compressed and plain", async () => {
    const plain = Buffer.from(text(2000));
    const accepted = await validateSubjectStructure(await chunks(plain), {
      declaredFormat: "VCF", expectedSize: plain.length, expectedSha256: null,
      maximumDecodedBytes: plain.length,
    });
    expect(accepted.decodedBytes).toBe(plain.length);
    expect(accepted.structuralValidatorVersion).toBe("single-logical-sample-v1");

    const compressed = gzipSync(plain);
    const unpacked = await validateSubjectStructure(await chunks(compressed), {
      declaredFormat: "VCF.GZ", expectedSize: compressed.length, expectedSha256: null,
      maximumDecodedBytes: plain.length,
    });
    // The stored size passes while the unpacked size is measured against the
    // same ceiling: exactly the boundary the capacity measurement exists for.
    expect(unpacked.decodedBytes).toBe(plain.length);
    expect(compressed.length).toBeLessThan(plain.length);
  });

  it("is refused when its unpacked content exceeds the ceiling, not its stored size", async () => {
    const plain = Buffer.from(text(2000));
    const compressed = gzipSync(plain);
    await expect(validateSubjectStructure(await chunks(compressed), {
      declaredFormat: "VCF.GZ", expectedSize: compressed.length, expectedSha256: null,
      maximumDecodedBytes: compressed.length,
    })).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("the synthetic gVCF shape", () => {
  it("is classified gVCF by the sniffer from its first data rows, while the default stays VCF", () => {
    const gvcf = Buffer.from(text(50, 1, { gvcf: true }));
    expect(sniffHeadV2(new Uint8Array(gvcf.subarray(0, 65536)), false).kind).toBe("gvcf");
    const vcf = Buffer.from(text(50));
    expect(sniffHeadV2(new Uint8Array(vcf.subarray(0, 65536)), false).kind).toBe("vcf");
    expect(vcf.toString()).not.toContain("<NON_REF>");
  });

  it("tiles reference blocks with END and a homozygous-reference genotype, one called site after every fourth block", () => {
    const data = rows(text(500, 1, { gvcf: true }));
    const blocks = data.filter(row => row[4] === "<NON_REF>");
    const calls = data.filter(row => row[4] !== "<NON_REF>");
    expect(blocks.length).toBe(400);
    expect(calls.length).toBe(100);
    expect(GVCF_BLOCKS_PER_VARIANT).toBe(4);
    for (const block of blocks) {
      const end = Number(/(?:^|;)END=(\d+)/.exec(block[7]!)?.[1]);
      expect(end).toBeGreaterThanOrEqual(Number(block[1]));
      expect(block[8]!.split(":")).toEqual(["GT", "DP", "GQ", "MIN_DP", "PL"]);
      expect(block[9]!.startsWith("0/0:")).toBe(true);
      expect(block[2]).toBe(".");
    }
    for (const call of calls) {
      expect(call[4]!.endsWith(",<NON_REF>")).toBe(true);
      expect(call[4]!.split(",")).toHaveLength(2);
      expect(call[8]!.split(":")).toEqual(["GT", "AD", "DP", "GQ", "PL"]);
      expect(call[7]).not.toContain("END=");
    }
  });

  it("is accepted by the finalizer's validator under the gVCF declaration, plain and compressed", async () => {
    const plain = Buffer.from(text(2000, 1, { gvcf: true }));
    const accepted = await validateSubjectStructure(await chunks(plain), {
      declaredFormat: "gVCF", expectedSize: plain.length, expectedSha256: null,
      maximumDecodedBytes: plain.length,
    });
    expect(accepted.decodedBytes).toBe(plain.length);
    const compressed = gzipSync(plain);
    const unpacked = await validateSubjectStructure(await chunks(compressed), {
      declaredFormat: "gVCF", expectedSize: compressed.length, expectedSha256: null,
      maximumDecodedBytes: plain.length,
    });
    expect(unpacked.decodedBytes).toBe(plain.length);
  });

  it("is read by the provenance counter as a single sample: 400 blocks, 100 called sites, none unsupported", async () => {
    const counts = emptyReadCounts();
    await drain(countInputLines(lines(text(500, 1, { gvcf: true })), "gvcf", counts));
    expect(counts.singleSample).toBe(true);
    expect(counts.blocks).toBe(400);
    expect(counts.called).toBe(100);
    expect(counts.noCall).toBe(0);
    expect(counts.unsupported).toBe(0);

    const plainCounts = emptyReadCounts();
    await drain(countInputLines(lines(text(500)), "vcf", plainCounts));
    expect(plainCounts.blocks).toBe(0);
    expect(plainCounts.called + plainCounts.noCall).toBe(500);
    expect(plainCounts.unsupported).toBe(0);
  });
});

describe("sizing a fixture by decoded bytes", () => {
  it("stops at the first row that reaches the target and reports the exact size", () => {
    for (const gvcf of [false, true]) {
      const stats = { records: 0, bytes: 0 };
      const body = text(Number.MAX_SAFE_INTEGER, 1, { gvcf, maximumBytes: 250_000, stats });
      expect(Buffer.byteLength(body)).toBe(stats.bytes);
      expect(stats.bytes).toBeGreaterThanOrEqual(250_000);
      expect(stats.bytes).toBeLessThan(250_000 + 400);
      expect(stats.records).toBe(rows(body).length);
      expect(stats.records).toBeGreaterThan(1000);
    }
  });

  it("is deterministic under a byte target and still spreads rows over several contigs", () => {
    const first = text(Number.MAX_SAFE_INTEGER, 3, { maximumBytes: 200_000 });
    expect(text(Number.MAX_SAFE_INTEGER, 3, { maximumBytes: 200_000 })).toBe(first);
    expect(new Set(rows(first).map(row => row[0])).size).toBeGreaterThan(1);
  });

  it("stops early when the record count is reached first", () => {
    const stats = { records: 0, bytes: 0 };
    text(10, 1, { maximumBytes: 10_000_000, stats });
    expect(stats.records).toBe(10);
    expect(stats.bytes).toBeLessThan(10_000);
  });
});
