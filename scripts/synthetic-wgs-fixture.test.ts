import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { syntheticVcfLines } from "./synthetic-wgs-fixture.mjs";
import { validateSubjectStructure } from "../src/lib/uploads/subject-structure";

function text(records: number, seed = 1) {
  return [...syntheticVcfLines(records, seed)].join("");
}
async function chunks(bytes: Buffer) {
  return (async function* () { yield new Uint8Array(bytes); })();
}

describe("the synthetic capacity fixture", () => {
  it("is byte-identical for a seed, so a measurement can be repeated exactly", () => {
    expect(text(500)).toBe(text(500));
    expect(text(500, 2)).not.toBe(text(500, 1));
  });

  it("emits one single-sample header and the exact ten columns the product requires", () => {
    const lines = text(200).split("\n").filter(Boolean);
    const headers = lines.filter(line => line.startsWith("#CHROM"));
    expect(headers).toHaveLength(1);
    expect(headers[0]!.split("\t").slice(0, 9).join("\t"))
      .toBe("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT");
    expect(headers[0]!.split("\t")).toHaveLength(10);
    expect(lines.filter(line => line.startsWith("##fileformat="))).toHaveLength(1);
    for (const row of lines.filter(line => !line.startsWith("#"))) {
      expect(row.split("\t")).toHaveLength(10);
    }
  });

  it("keeps positions ascending inside each contig, as a sorted caller emits them", () => {
    const rows = text(3000).split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split("\t"));
    const seen = new Map<string, number>();
    for (const [contig, position] of rows) {
      const at = Number(position);
      expect(at).toBeGreaterThan(0);
      if (seen.has(contig!)) expect(at).toBeGreaterThan(seen.get(contig!)!);
      seen.set(contig!, at);
    }
    expect(seen.size).toBeGreaterThan(1);
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
