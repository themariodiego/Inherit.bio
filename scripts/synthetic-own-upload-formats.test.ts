import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { syntheticOwnUploadFormats } from "./synthetic-own-upload-formats";
import { sniffV2 } from "../src/lib/genome/parsers/sniff";
import { sniffFileV2 } from "../src/lib/genome/parsers/sniff-browser";
import { parseArray, type ArrayKind } from "../src/lib/genome/parsers/array";
import { parseVcf } from "../src/lib/genome/parsers/vcf";
import { toLines } from "../src/lib/genome/parsers/lines";
import { declaredSubjectFormat } from "../src/lib/uploads/subject-upload-contract";
import { validateSubjectStructure } from "../src/lib/uploads/subject-structure";

async function* source(bytes: Uint8Array) {
  for (let at = 0; at < bytes.length; at += 17) yield bytes.subarray(at, at + 17);
}

describe("own-upload format matrix", () => {
  for (const fixture of syntheticOwnUploadFormats) {
    for (const encoding of ["plain", "gzip", "multi-member gzip"]) {
      it(`${fixture.id}: ${encoding} keeps exact bytes, calls and decoded limits`, async () => {
        const decoded = Buffer.from(fixture.text);
        const bytes = encoding === "plain" ? decoded : encoding === "gzip" ? gzipSync(decoded)
          : Buffer.concat([gzipSync(decoded.subarray(0, 93)), gzipSync(decoded.subarray(93))]);
        expect(sniffV2(bytes)).toMatchObject({ kind: fixture.kind, compressed: encoding !== "plain" });
        expect(await sniffFileV2(bytes)).toMatchObject({ kind: fixture.kind, compressed: encoding !== "plain" });
        const format = declaredSubjectFormat(fixture.kind, encoding !== "plain")!;
        const declaration = { declaredFormat: format, expectedSize: bytes.length,
          expectedSha256: createHash("sha256").update(bytes).digest("hex"), maximumDecodedBytes: decoded.length };
        await expect(validateSubjectStructure(source(bytes), declaration)).resolves.toMatchObject({
          rawBytes: bytes.length, decodedBytes: decoded.length,
          rawSha256: declaration.expectedSha256, decodedSha256: createHash("sha256").update(decoded).digest("hex"),
        });
        await expect(validateSubjectStructure(source(bytes), { ...declaration, maximumDecodedBytes: decoded.length - 1 }))
          .rejects.toMatchObject({ code: "too_large" });
        const parsed = fixture.kind.startsWith("array_") ? await parseArray(toLines(source(bytes)), fixture.kind as ArrayKind)
          : await parseVcf(toLines(source(bytes)));
        expect(parsed.build).toBe("GRCh38");
        expect(parsed.records.map(({ rsid, chrom, pos, genotype }) => ({ rsid, chrom, pos, genotype }))).toEqual([
          { rsid: 4988235, chrom: 2, pos: 135851076, genotype: "A/A" },
          { rsid: 1815739, chrom: 11, pos: 66560624, genotype: "C/T" },
          { rsid: 762551, chrom: 15, pos: 74749576, genotype: "A/C" },
        ]);
        expect(parsed.referenceCalls).toEqual([]);
        expect(parsed.skipped).toBe(0);
      });
    }
  }
});
