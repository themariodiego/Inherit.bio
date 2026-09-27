import { describe, expect, it } from "vitest";
import { originalDownloadName, originalFileExtension } from "./original-download-name";

const RAW = "a".repeat(64), DECODED = "b".repeat(64);
const plain = (file_type: string) => ({ file_type, sha256: RAW, source_sha256: RAW });
const gzip = (file_type: string) => ({ file_type, sha256: RAW, source_sha256: DECODED });

describe("the name an original is saved under", () => {
  it("gives every canonical kind the extension that opens it", () => {
    for (const kind of ["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna"]) {
      expect(originalFileExtension(plain(kind)), kind).toBe(".txt");
      expect(originalFileExtension(gzip(kind)), kind).toBe(".txt.gz");
    }
    expect(originalFileExtension(plain("vcf"))).toBe(".vcf");
    expect(originalFileExtension(gzip("vcf"))).toBe(".vcf.gz");
    expect(originalFileExtension(plain("gvcf"))).toBe(".g.vcf");
    expect(originalFileExtension(gzip("gvcf"))).toBe(".g.vcf.gz");
  });

  it("keeps the generic base name and adds the extension to it", () => {
    expect(originalDownloadName({ original_name: "Genome file", ...plain("array_23andme") })).toBe("Genome file.txt");
    expect(originalDownloadName({ original_name: "Genome file", ...gzip("vcf") })).toBe("Genome file.vcf.gz");
    expect(originalDownloadName({ original_name: "Genome file", ...gzip("gvcf") })).toBe("Genome file.g.vcf.gz");
  });

  it("does not add an extension the name already ends with", () => {
    expect(originalDownloadName({ original_name: "Genome file.VCF.GZ", ...gzip("vcf") })).toBe("Genome file.VCF.GZ");
  });

  it("leaves a name alone when the stored bytes cannot be known", () => {
    // A legacy upload records no decoded hash, and kept the person's own name.
    expect(originalDownloadName({ original_name: "my-23andme.zip", file_type: "array_23andme", sha256: RAW, source_sha256: null }))
      .toBe("my-23andme.zip");
    expect(originalFileExtension({ file_type: "vcf", sha256: null, source_sha256: DECODED })).toBe("");
    // A kind with no mapping gets none rather than a guess.
    expect(originalDownloadName({ original_name: "Genome file", ...plain("bam") })).toBe("Genome file");
    expect(originalFileExtension({ file_type: undefined, sha256: RAW, source_sha256: RAW })).toBe("");
  });
});
