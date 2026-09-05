import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCarrierPairVcf } from "../e2e/fixtures/carrier-pair-fixture";

describe("happy-path caffeine fixture identity", () => {
  const templates = JSON.parse(readFileSync("data/templates/lifestyle-wellness.json", "utf8"));
  const variant = templates.find((template: { slug: string }) => template.slug === "caffeine-metabolism-cyp1a2-rs762551").variants[0];

  for (const name of ["tiny-grch38.vcf", "carrier-pair-grch38.vcf", "personal-previews-grch38.vcf"]) {
    it(`${name} keeps exact GRCh38 REF/ALT and the invented A/C call`, () => {
      const rows = readFileSync(`e2e/fixtures/${name}`, "utf8").split("\n")
        .filter((line) => !line.startsWith("#"))
        .map((line) => line.split("\t"))
        .filter((columns) => columns[2] === "rs762551");
      expect(rows).toHaveLength(1);
      const [chrom, pos, , ref, alt, , , , format, sample] = rows[0];
      expect([Number(chrom.replace(/^chr/, "")), Number(pos), ref, alt])
        .toEqual([variant.chrom, variant.pos38, variant.ref, variant.alt]);
      expect([ref, alt]).toEqual(["C", "A"]);
      expect(sample.split(":")[format.split(":").indexOf("GT")]).toBe("0/1");
      expect([ref, alt].sort().join("/")).toBe("A/C");
    });
  }

  it("keeps the committed carrier fixture identical to its generator", () => {
    expect(readFileSync("e2e/fixtures/carrier-pair-grch38.vcf", "utf8"))
      .toBe(`${buildCarrierPairVcf().join("\n")}\n`);
  });
});
