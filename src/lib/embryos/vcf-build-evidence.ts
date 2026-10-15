import { embryoFileStream, embryoInputLines, EmbryoTransportError } from "./ingest-lines";

/**
 * What the configure route may learn about a chosen VCF before the upload
 * begins (register `api.embryo-ingest-configure`, ADR 0035): its
 * `##fileformat`, `##reference` and `##contig` lines, verbatim, and its
 * sample count. Browser memory only.
 *
 * Nothing else is read into the result. Sample names, the `#CHROM` line and
 * every other meta line stay on this device; reading stops at the column
 * line, so no record is decoded at all. The limits are the route's own:
 * at most 64 lines of at most 512 characters. The file format and every
 * reference line come first, because the build rule reads those before any
 * contig; a longer contig list is cut at the limit rather than refused,
 * since the lines kept already name the build or conflict.
 */
export const EVIDENCE_MAXIMUM_LINES = 64;
export const EVIDENCE_MAXIMUM_CHARACTERS = 512;

export interface VcfBuildEvidence {
  buildEvidence: string[];
  sampleCount: number;
}

const COLUMNS = "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT";

export async function embryoVcfBuildEvidence(file: Blob): Promise<VcfBuildEvidence> {
  const heads: string[] = [];
  const contigs: string[] = [];
  let first = true;
  for await (const line of embryoInputLines(await embryoFileStream(file))) {
    if (first) {
      first = false;
      if (!/^##fileformat=VCFv4\.[0-5]$/.test(line)) throw new EmbryoTransportError("unrecognised_format");
      heads.push(line);
      continue;
    }
    if (line.startsWith("##")) {
      if (line.length > EVIDENCE_MAXIMUM_CHARACTERS) continue;
      if (line.startsWith("##reference=")) heads.push(line);
      else if (line.startsWith("##contig=")) contigs.push(line);
      continue;
    }
    const columns = line.split("\t");
    if (columns.slice(0, 9).join("\t") !== COLUMNS || columns.length < 10) {
      throw new EmbryoTransportError("unrecognised_format");
    }
    // Leaving the loop cancels the stream: no record line is read.
    return {
      buildEvidence: [...heads, ...contigs].slice(0, EVIDENCE_MAXIMUM_LINES),
      sampleCount: columns.length - 9,
    };
  }
  throw new EmbryoTransportError("empty_after_parse");
}
