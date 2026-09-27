import { describe, expect, it } from "vitest";
import { OWN_UPLOAD_COPY } from "./consent";

const unpacked = " A compressed file is measured after it is unpacked, so the unpacked size has to fit as well.";

describe("upload ceiling disclosure", () => {
  it("keeps the shared limit sentence when all three ceilings match", () => {
    expect(OWN_UPLOAD_COPY.limitStatement(25, 25, 25)).toBe(`We can take files up to 25 MB.${unpacked}`);
  });

  it.each([undefined, 25])("keeps VCF and gVCF together when their ceilings match or fall back (%s)", gvcf => {
    expect(OWN_UPLOAD_COPY.limitStatement(52, 25, gvcf)).toBe(
      `We can take genotype table files up to 52 MB, and VCF or gVCF files up to 25 MB.${unpacked}`);
  });

  it.each([52, 2147])("names all three ceilings when gVCF differs, including when array and VCF match (%s)", array => {
    const statement = OWN_UPLOAD_COPY.limitStatement(array, 2147, 4294);
    expect(statement).toContain(`genotype table files up to ${array} MB`);
    expect(statement).toContain("VCF files up to 2147 MB");
    expect(statement).toContain("gVCF files up to 4294 MB");
    expect(statement).not.toContain("VCF or gVCF");
    expect(statement).toContain(unpacked);
  });

  it("also discloses a lower gVCF ceiling", () => {
    const statement = OWN_UPLOAD_COPY.limitStatement(52, 100, 25);
    expect(statement).toContain("VCF files up to 100 MB");
    expect(statement).toContain("gVCF files up to 25 MB");
  });
});
