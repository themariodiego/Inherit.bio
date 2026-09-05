import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildLiftover, liftSingleBaseVariant, type Liftover } from "./liftover";

const CHAIN_PATH = join(
  process.cwd(),
  "data/ref/chain/GRCh37_to_GRCh38.chain.gz",
);

// Truth pairs fetched live from Ensembl REST on 2026-08-28:
// GRCh37 from https://grch37.rest.ensembl.org/variation/human/<rsid>
// GRCh38 from https://rest.ensembl.org/variation/human/<rsid>
// Chromosomes numeric per src/lib/genome/types.ts (X=23, MT=25); 1-based positions.
const TRUTH: {
  rsid: string;
  chrom: number;
  pos37: number;
  chrom38: number;
  pos38: number;
}[] = [
  { rsid: "rs1801133", chrom: 1, pos37: 11856378, chrom38: 1, pos38: 11796321 },
  // rs1642149602 lies in GRCh37 chr1:317720-471368, which the chain maps to a
  // '-' strand target block (alleles complement T/G -> A/C on Ensembl),
  // exercising the strand-flip path.
  { rsid: "rs1642149602", chrom: 1, pos37: 400568, chrom38: 1, pos38: 418769 },
  { rsid: "rs4988235", chrom: 2, pos37: 136608646, chrom38: 2, pos38: 135851076 },
  { rsid: "rs53576", chrom: 3, pos37: 8804371, chrom38: 3, pos38: 8762685 },
  { rsid: "rs1815739", chrom: 11, pos37: 66328095, chrom38: 11, pos38: 66560624 },
  { rsid: "rs762551", chrom: 15, pos37: 75041917, chrom38: 15, pos38: 74749576 },
  { rsid: "rs1042522", chrom: 17, pos37: 7579472, chrom38: 17, pos38: 7676154 },
  { rsid: "rs429358", chrom: 19, pos37: 45411941, chrom38: 19, pos38: 44908684 },
  { rsid: "rs4680", chrom: 22, pos37: 19951271, chrom38: 22, pos38: 19963748 },
  { rsid: "rs5030868", chrom: 23, pos37: 153762634, chrom38: 23, pos38: 154534419 },
  { rsid: "rs2853826", chrom: 25, pos37: 10398, chrom38: 25, pos38: 10398 },
];

describe("buildLiftover", () => {
  let lift: Liftover;

  beforeAll(() => {
    lift = buildLiftover(new Uint8Array(readFileSync(CHAIN_PATH)));
  });

  for (const t of TRUTH) {
    it(`maps ${t.rsid} (chrom ${t.chrom})`, () => {
      expect(lift(t.chrom, t.pos37)).toEqual({
        chrom: t.chrom38,
        pos: t.pos38,
        strand: t.rsid === "rs1642149602" ? -1 : 1,
      });
    });
  }

  it("returns null for an unmappable position", () => {
    // chr1:267720-317719 (1-based) falls in the gap between the first two
    // chains of the file; 300000 is uncovered by any block.
    expect(lift(1, 300000)).toBeNull();
  });

  it("returns null for a chromosome absent from the chain file", () => {
    expect(lift(99, 12345)).toBeNull();
  });

  it("orients all single-base alleles across a reverse-strand block", () => {
    expect(liftSingleBaseVariant({ rsid: 1642149602, chrom: 1, pos: 400568, ref: "T", alt: "G", genotype: "G/T" }, lift)).toEqual({
      rsid: 1642149602, chrom: 1, pos: 418769, ref: "A", alt: "C", genotype: "A/C",
    });
  });

  it("keeps a reference-free array call reference-free after strand correction", () => {
    expect(liftSingleBaseVariant({ rsid: 1642149602, chrom: 1, pos: 400568, ref: null, alt: null, genotype: "G/T" }, lift)).toEqual({
      rsid: 1642149602, chrom: 1, pos: 418769, ref: null, alt: null, genotype: "A/C",
    });
  });

  it("withholds indels and unknown calls that point liftover cannot normalize", () => {
    expect(liftSingleBaseVariant({ rsid: null, chrom: 1, pos: 400568, ref: "CT", alt: "C", genotype: "C/CT" }, lift)).toBeNull();
    expect(liftSingleBaseVariant({ rsid: null, chrom: 1, pos: 400568, ref: null, alt: null, genotype: "--" }, lift)).toBeNull();
  });
});
