import type { PreparedSourceBinding } from "./schema";

// Artificial, small parser corpus. No customer file or private credential.
export const syntheticSource: PreparedSourceBinding = {
  fileId: "11111111-1111-4111-8111-111111111111", subjectId: "22222222-2222-4222-8222-222222222222",
  sourceRevision: 1, rawSha256: "a".repeat(64), decodedSha256: "b".repeat(64),
  sourceBuild: "GRCh38", parserRevision: "synthetic-parity-v1",
};
export const syntheticHeader = ["##fileformat=VCFv4.2", "##reference=GRCh38",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC"];
export const syntheticRows = [
  "1\t12\trs12\tA\tC\t.\tPASS\t.\tGT:GQ:DP\t0/1:0:12.5",
  "1\t10\trs10\tA\tC\t.\tPASS\t.\tGT\t0/0", // unsorted called reference
  "1\t11\trs11\tA\tC\t.\tPASS\t.\tGT\t./.",
  "1\t13\trs13\tA\tC\t.\tq10;é\t.\tGT:FT:GQ:DP\t1|1:FAIL:3:2",
  "1\t14\trs14\tA\tC\t.\t.\t.\tGT\t1", // haploid, not usable diploid observation
  "1\t15\t.\tA\tCTT\t.\tPASS\t.\tGT\t0/1", // no rsID, long allele preserved
  "1\t12\trs12\tA\tC\t.\tPASS\t.\tGT:GQ:DP\t0/1:0:12.5", // duplicate preserved
  "1\t12\trs12\tA\tC\t.\tPASS\t.\tGT\t1/1", // conflict preserved for later writer
  "1\t16\trs16\tA\t<NON_REF>\t.\tPASS\tEND=100\tGT\t0/0", // no fabricated block observations
];
export async function* syntheticLines(rows = syntheticRows) { yield* syntheticHeader; yield* rows; }
