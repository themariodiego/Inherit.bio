/**
 * The two synthetic embryos of `e2e/fixtures/embryo-pair-grch38.vcf` as a
 * laboratory table (ADR 0037), derived from the VCF's own rows and nothing
 * else. Each locus becomes one row per embryo: an invented embryo label, the
 * VCF's chromosome and position, and the called bases its genotype states
 * (`--` where the VCF has no call).
 *
 * The table states no build, so ingest asks GRCh37, GRCh38 or unknown, and
 * its call column is named `Bases`, which no header synonym matches, so
 * ingest asks which column holds the result. The `#` line marks the file as
 * synthetic; the product reads only `##reference` and `##contig` lines from
 * a table's preamble, and this file has neither.
 *
 * This module has no file access, so the browser journey can import its
 * names. `scripts/generate-embryo-pair-fixture.ts` writes and checks the file.
 */
export const EMBRYO_PAIR_TABLE_FIXTURE = "e2e/fixtures/embryo-pair-table-unstated-build.csv";
export const TABLE_EMBRYOS = ["SYNTHETIC_EMBRYO_1", "SYNTHETIC_EMBRYO_2"] as const;
export const TABLE_HEADER = ["Embryo", "Chromosome", "Position", "Bases"] as const;
const PROVENANCE_LINE = "#Inherit deterministic synthetic laboratory table; no real person; two synthetic embryos; "
  + "derived from e2e/fixtures/embryo-pair-grch38.vcf by scripts/generate-embryo-pair-fixture.ts";

export function buildEmbryoPairTable(vcf: string): string {
  const lines: string[] = [PROVENANCE_LINE, TABLE_HEADER.join(",")];
  for (const line of vcf.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    const alleles = [fields[3], ...fields[4].split(",")];
    TABLE_EMBRYOS.forEach((label, sample) => {
      const called = fields[9 + sample].split(/[/|]/);
      const bases = called.includes(".") ? "--" : called.map((index) => alleles[Number(index)]).join("");
      lines.push([label, fields[0], fields[1], bases].join(","));
    });
  }
  return `${lines.join("\n")}\n`;
}
