import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sniffV2 } from "./sniff";
import { sniffFileV2 } from "./sniff-browser";
import { parseVcf } from "./vcf";
import { toLines } from "./lines";
import { declaredSubjectFormat, uploadCeilingBytes } from "../../uploads/subject-upload-contract";
import { validateSubjectStructure } from "../../uploads/subject-structure";

const header = "##fileformat=VCFv4.3\n##reference=GRCh38\n";
const columns = "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC\n";
async function* chunks(bytes: Uint8Array) {
  for (let at = 0; at < bytes.length; at += 13) yield bytes.subarray(at, at + 13);
}

describe("gVCF format compatibility", () => {
  it.each(["NON_REF", "*"])("recognizes declared %s before records enter the sniff window", async symbol => {
    const text = header + `##ALT=<ID=${symbol},Description="Unspecified alternative allele">\n`
      + "##synthetic=padding\n".repeat(4000) + columns;
    const bytes = Buffer.from(text);
    for (const source of [bytes, gzipSync(bytes)]) {
      expect(sniffV2(source).kind).toBe("gvcf");
      const browser = await sniffFileV2(source);
      expect(browser.kind).toBe("gvcf");
      const format = declaredSubjectFormat("gvcf", browser.compressed);
      expect(format).toBe("gVCF");
      expect(uploadCeilingBytes(format!, { maximumArrayBytes: 100, maximumVcfBytes: 200,
        maximumGvcfBytes: 300, maximumAccountBytes: 1000, maximumActiveUploads: 2,
        reservedBytes: 0, activeUploads: 0 })).toBe(300);
    }
  });

  it("does not let commentary or an INFO value choose the gVCF ceiling", async () => {
    const bytes = Buffer.from(header + '##comment="This is not a <NON_REF> or <*> record"\n'
      + columns + "1\t100\trs1\tA\tG\t50\tPASS\tNOTE=<NON_REF>\tGT\t0/1\n");
    expect(sniffV2(bytes).kind).toBe("vcf");
    expect((await sniffFileV2(bytes)).kind).toBe("vcf");
  });

  for (const symbol of ["<NON_REF>", "<*>"]) {
    for (const compressed of [false, true]) {
      it(`preserves called sites but never invents calls from ${symbol} blocks (${compressed ? "gzip" : "plain"})`, async () => {
        const text = header + columns
          + `1\t100\trs1\tA\t${symbol}\t50\tPASS\tEND=199\tGT\t0/0\n`
          + `1\t200\trs2\tC\tT,${symbol}\t50\tPASS\t.\tGT:GQ:DP\t0/1:42:18\n`
          + `1\t300\trs3\tG\t${symbol}\t50\tPASS\t.\tGT:LEN\t0/0:100\n`
          + `1\t400\trs4\tC\tT,${symbol}\t50\tPASS\t.\tGT\t0/2\n`
          + `1\t500\trs5\tC\tT,${symbol}\t50\tPASS\t.\tGT\t0/0\n`;
        const decoded = Buffer.from(text), bytes = compressed ? gzipSync(decoded) : decoded;
        expect(sniffV2(bytes)).toMatchObject({ kind: "gvcf", compressed, sampleCount: 1 });
        const hash = createHash("sha256").update(bytes).digest("hex");
        await expect(validateSubjectStructure(chunks(bytes), { declaredFormat: "gVCF", expectedSize: bytes.length,
          expectedSha256: hash, maximumDecodedBytes: decoded.length })).resolves.toMatchObject({
          rawSha256: hash, rawBytes: bytes.length, decodedBytes: decoded.length,
        });
        await expect(validateSubjectStructure(chunks(bytes), { declaredFormat: "gVCF", expectedSize: bytes.length,
          expectedSha256: hash, maximumDecodedBytes: decoded.length - 1 })).rejects.toMatchObject({ code: "too_large" });
        const result = await parseVcf(toLines(chunks(bytes)));
        expect(result.records).toEqual([{ rsid: 2, chrom: 1, pos: 200, ref: "C", alt: "T", genotype: "C/T" }]);
        expect(result.referenceCalls).toEqual([]);
        expect(result.observedCalls).toHaveLength(1);
        expect(result.observedCalls![0]).toMatchObject({ rsid: 2, genotype: "C/T", usable: true, genotypeQuality: 42, depth: 18 });
      });
    }
  }

  it.each(["END=199", "SVLEN=100"])("does not turn interval metadata %s into a reference point", async info => {
    const bytes = Buffer.from(header + columns + `1\t100\trs1\tA\t.\t50\tPASS\t${info}\tGT\t0/0\n`);
    const result = await parseVcf(toLines(chunks(bytes)));
    expect(result.referenceCalls).toEqual([]);
    expect(result.observedCalls).toEqual([]);
  });
});
