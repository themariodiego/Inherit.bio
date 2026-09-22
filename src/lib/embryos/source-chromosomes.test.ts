import { describe, expect, it } from "vitest";
import { embryoSourceChromosome, isEmbryoSourceChromosome } from "./source-chromosomes";

describe("embryo source chromosome retention", () => {
  it("keeps every autosome and normalizes X/Y aliases to the shared numeric representation", () => {
    for (let chrom = 1; chrom <= 24; chrom++) {
      expect(isEmbryoSourceChromosome(chrom)).toBe(true);
      expect(embryoSourceChromosome(String(chrom))).toBe(chrom);
      expect(embryoSourceChromosome(`chr${chrom}`)).toBe(chrom);
    }
    for (const alias of ["X", "x", "chrX", "ChrX"]) expect(embryoSourceChromosome(alias)).toBe(23);
    for (const alias of ["Y", "y", "chrY", "ChrY"]) expect(embryoSourceChromosome(alias)).toBe(24);
  });

  it.each(["M", "MT", "chrM", "chrMT", "25", "26", "0", "-1", "1.5", "PAR1", "PAR2", "chrUn", "1_random", "__proto__"])(
    "does not guess an unsupported contig %s", contig => expect(embryoSourceChromosome(contig)).toBeNull(),
  );

  it("rejects invalid numeric positions in the chromosome range", () => {
    for (const chrom of [0, -1, 1.5, 25, 26, NaN, Infinity]) expect(isEmbryoSourceChromosome(chrom)).toBe(false);
  });
});
