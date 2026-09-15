import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import receipt from "../e2e/fixtures/synthetic-browser-grch38.receipt.json";
import { countInputLines, emptyReadCounts } from "../src/lib/genome/input-provenance";
import { toLines } from "../src/lib/genome/parsers/lines";
import { parseVcf } from "../src/lib/genome/parsers/vcf";
import { estimateRegionalAdmixture, REGIONAL_EMPTY_NOTE } from "../src/lib/genome/regional-admixture";
import { BROWSER_FIXTURE, buildBrowserVcf, compressSyntheticVcf } from "./generate-synthetic-vcf-fixtures";

describe("independently generated synthetic browser VCF", () => {
  it("pins the committed compressed transport bytes and their declaration receipt", () => {
    const compressed = readFileSync(path.join(process.cwd(), BROWSER_FIXTURE));
    const decoded = Buffer.from(buildBrowserVcf());
    expect(compressed).toEqual(compressSyntheticVcf(decoded.toString("utf8")));
    expect(compressed.length).toBe(receipt.fixture.compressedBytes);
    expect(createHash("sha256").update(compressed).digest("hex")).toBe(receipt.fixture.sha256);
    expect(decoded.length).toBe(receipt.fixture.decodedBytes);
    expect(createHash("sha256").update(decoded).digest("hex")).toBe(receipt.fixture.decodedSha256);
  });

  it("streams 144 calls, excludes 17 indels from read rate, and produces no ancestry shares", async () => {
    const counts = emptyReadCounts();
    const parsed = await parseVcf(countInputLines(
      toLines(createReadStream(path.join(process.cwd(), BROWSER_FIXTURE)) as never), "vcf", counts,
    ));
    expect(parsed.build).toBe("GRCh38");
    expect(parsed.skipped).toBe(0);
    expect(parsed.records).toHaveLength(144);
    expect(counts).toEqual({ called: 127, noCall: 0, unsupported: 17, failedFilter: 0,
      blocks: 0, singleSample: true, buildClaim: true });
    expect(counts).toEqual(receipt.fixture.counts);
    expect(parsed.records[0]).toEqual({ rsid: null, chrom: 20, pos: 1_000_003, ref: "A", alt: "C", genotype: "C/C" });
    expect(parsed.records[0]).toEqual(receipt.fixture.firstPoint);
    expect(parsed.records.every(record => record.rsid === null && record.chrom === 20 &&
      record.pos >= 1_000_000 && record.pos <= 1_100_000)).toBe(true);
    const calls = new Map(parsed.records.map(record => [`${record.chrom}:${record.pos}`, record.genotype]));
    const ancestry = estimateRegionalAdmixture((chrom, pos) => calls.get(`${chrom}:${pos}`) ?? null);
    expect(ancestry.markersUsed).toBe(0);
    expect(ancestry.proportions).toBeNull();
    expect(ancestry.note).toBe(REGIONAL_EMPTY_NOTE);
  });
});
