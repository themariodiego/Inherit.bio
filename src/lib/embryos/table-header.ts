import {
  detectPgtHeaderCells,
  isForbiddenHeaderCell,
  planMapping,
  splitHeaderLine,
  type MappingPlan,
  type PgtHeader,
} from "../genome/parsers/pgt-table";
import { embryoFileStream, embryoInputLines, EmbryoTransportError } from "./ingest-lines";
import { EVIDENCE_MAXIMUM_CHARACTERS, EVIDENCE_MAXIMUM_LINES } from "./vcf-build-evidence";

/**
 * What the browser learns from a chosen laboratory table before the upload
 * begins (ADR 0037), in browser memory only:
 *
 * - `buildEvidence`: the table's own `##reference` and `##contig` header
 *   lines, verbatim, at most 64 lines of at most 512 characters. Only these
 *   reach the configure route, which decides the build from them.
 * - `copy`: the bounded header copy the mapping route inspects. Every
 *   forbidden sex, gender, karyotype or proxy column is dropped here, before
 *   any byte leaves the device (X10.2), and an empty cell is sent as `-`,
 *   which the header rule reads exactly as it reads an empty cell. `source`
 *   maps each copy position back to the file's own column.
 * - `header` and `plan`: this browser's own run of the header rule over the
 *   copy. The server repeats it and is never told this answer.
 *
 * Reading stops at the column row, so no data row is decoded here.
 */
export interface TableHeaderCopy {
  buildEvidence: string[];
  copy: string[];
  source: number[];
  /** The file's own header text per copy position, for the reader's screen only; never sent. */
  labels: string[];
  header: PgtHeader;
  plan: MappingPlan;
}

export const HEADER_COPY_MAXIMUM_COLUMNS = 128;
export const HEADER_COPY_MAXIMUM_CHARACTERS = 80;

/** True when the file opens as a VCF, which takes the VCF path instead. */
export async function opensAsVcf(file: Blob): Promise<boolean> {
  for await (const line of embryoInputLines(await embryoFileStream(file))) return line.startsWith("##fileformat=VCF");
  return false;
}

export async function embryoTableHeader(file: Blob): Promise<TableHeaderCopy> {
  const references: string[] = [];
  const contigs: string[] = [];
  for await (const line of embryoInputLines(await embryoFileStream(file))) {
    if (line.startsWith("#")) {
      if (line.length > EVIDENCE_MAXIMUM_CHARACTERS) continue;
      if (line.startsWith("##reference=")) references.push(line);
      else if (line.startsWith("##contig=")) contigs.push(line);
      continue;
    }
    const { delimiter, cells } = splitHeaderLine(line);
    const kept = cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => !isForbiddenHeaderCell(cell));
    if (kept.length > HEADER_COPY_MAXIMUM_COLUMNS || kept.some(({ cell }) => cell.length > HEADER_COPY_MAXIMUM_CHARACTERS)) {
      throw new EmbryoTransportError("unrecognised_format");
    }
    const copy = kept.map(({ cell }) => cell === "" ? "-" : cell);
    const header = detectPgtHeaderCells(copy, delimiter);
    if (!header) throw new EmbryoTransportError("unrecognised_format");
    // Leaving the loop cancels the stream: no data row is read.
    return {
      buildEvidence: [...references, ...contigs].slice(0, EVIDENCE_MAXIMUM_LINES),
      copy, source: kept.map(({ index }) => index), labels: kept.map(({ cell }) => cell),
      header, plan: planMapping(header),
    };
  }
  throw new EmbryoTransportError("empty_after_parse");
}
