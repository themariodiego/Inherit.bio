import { gzipSync } from "node:zlib";

/** Wholly synthetic single-sample source: positions, alleles and calls are
 * invented for export pagination, not scientific findings or a real person.
 * 2,005 distinct called positions cross three 1,000-row pages. The separate
 * tiny-grch38.vcf remains the source of the test's covered caffeine finding.
 */
export function exportPaginationFixture() {
  const variantCount = 2_005;
  const rows = Array.from({ length: variantCount }, (_, index) =>
    `20\t${1_000_000 + index}\t.\tA\tC\t60\tPASS\t.\tGT:GQ:DP\t0/1:99:30`);
  const decoded = Buffer.from([
    "##fileformat=VCFv4.2",
    "##reference=GRCh38",
    "##source=Inherit-wholly-synthetic-export-pagination",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">',
    '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read depth">',
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC",
    ...rows, "",
  ].join("\n"));
  return { variantCount, decoded, compressed: gzipSync(decoded, { level: 9 }) };
}
