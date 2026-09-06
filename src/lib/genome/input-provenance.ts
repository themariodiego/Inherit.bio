import type { Build, FileKind } from "./types";
import { chromToNumber } from "./types";
import { arrayFields, arrayRow, type ArrayKind } from "./parsers/array";
import { buildFromHeader } from "./parsers/vcf";
import { observedVcfPointCall } from "./observed-calls";

export const INPUT_PROVENANCE_VERSION = "listed-calls-v1";

/** Counts describe listed, supported point records, never genome-wide coverage. */
export interface InputReadCounts {
  called: number;
  noCall: number;
  unsupported: number;
  failedFilter: number;
  blocks: number;
  singleSample: boolean;
  buildClaim: boolean;
}

export interface InputProvenanceSnapshot {
  version: typeof INPUT_PROVENANCE_VERSION;
  sourceSha256: string;
  completedAt: string;
  sourceBuild: Build;
  buildBasis: "source-declared" | "format-assumption";
  targetBuild: "GRCh38";
  chainSha256: string | null;
  variantRowsMapped: number;
  variantRowsUnmapped: number;
  counts: InputReadCounts;
}

export function emptyReadCounts(): InputReadCounts {
  return { called: 0, noCall: 0, unsupported: 0, failedFilter: 0, blocks: 0, singleSample: false, buildClaim: false };
}

/** Observe the same decoded stream the parser consumes, without altering it. */
export async function* countInputLines(lines: AsyncIterable<string>, kind: FileKind, counts: InputReadCounts) {
  let headers = 0;
  let dataBeforeHeader = false;
  const vcf = kind === "vcf" || kind === "gvcf";
  if (!vcf) counts.singleSample = true;
  for await (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("#")) {
      if (vcf && line.startsWith("#CHROM\t")) {
        headers++;
        counts.singleSample = !dataBeforeHeader && headers === 1 && line.split("\t").length === 10;
      }
      if (vcf ? ["GRCh37", "GRCh38"].includes(buildFromHeader(line) ?? "") : /(?:build\s*|GRCh|hg)\d+/i.test(line)) counts.buildClaim = true;
    } else if (line) {
      const columns = vcf ? line.split("\t") : arrayFields(line, kind as ArrayKind);
      if (!vcf && columns[0]?.toLowerCase() === "rsid") { yield raw; continue; }
      if (vcf) {
        if (headers === 0) dataBeforeHeader = true;
        const chrom = chromToNumber(columns[0]);
        const pos = Number(columns[1]);
        if (columns.length !== 10 || chrom === null || !Number.isInteger(pos) || pos <= 0) counts.unsupported++;
        else if (/(?:^|;)END=|(?:^|;)SVLEN=/.test(columns[7]) || columns[8].split(":").includes("LEN") || columns[4].includes("<NON_REF>")) counts.blocks++;
        else {
          const observed = observedVcfPointCall(columns, chrom, pos, 0);
          const gt = observed?.sourceGt;
          if (observed && gt && /^(?:\.|[01])[/|](?:\.|[01])$/.test(gt) && gt.includes(".")) counts.noCall++;
          else if (observed && observed.genotype !== "--") counts.called++;
          else counts.unsupported++;
          if (observed?.quality === "failed") counts.failedFilter++;
        }
      } else {
        const record = arrayRow(columns, kind as ArrayKind);
        if (record === "unsupported") counts.unsupported++;
        else if (record === "no-call") counts.noCall++;
        else counts.called++;
      }
    }
    yield raw;
  }
}

/** A legacy row or stale/partial completion never acquires invented quality. */
export function readInputSnapshot(raw: unknown, finishedAt: string | null, status: string, digest: string | null): InputProvenanceSnapshot | null {
  if (!raw || typeof raw !== "object" || status !== "annotated") return null;
  const value = raw as InputProvenanceSnapshot;
  const completed = Date.parse(value.completedAt), finished = Date.parse(finishedAt ?? "");
  if (value.version !== INPUT_PROVENANCE_VERSION || !Number.isFinite(completed) || completed !== finished || value.sourceSha256 !== digest ||
      !/^[0-9a-f]{64}$/.test(value.sourceSha256 ?? "") || !["GRCh37", "GRCh38"].includes(value.sourceBuild) ||
      value.targetBuild !== "GRCh38" || !["source-declared", "format-assumption"].includes(value.buildBasis) ||
      (value.sourceBuild === "GRCh37" ? !/^[0-9a-f]{64}$/.test(value.chainSha256 ?? "") : value.chainSha256 !== null)) return null;
  const counts = value.counts;
  if (!counts || [counts.called, counts.noCall, counts.unsupported, counts.failedFilter, counts.blocks,
    value.variantRowsMapped, value.variantRowsUnmapped].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    typeof counts.singleSample !== "boolean" || typeof counts.buildClaim !== "boolean") return null;
  return value;
}
