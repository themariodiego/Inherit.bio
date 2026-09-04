// Format detection from the first bytes of an uploaded raw genome file.

import { gunzipSync, constants as zlibConstants } from "node:zlib";
import type { FileKind } from "../types";
import { detectPgtHeader } from "./pgt-table";

export interface SniffResult {
  kind: FileKind | null;
  compressed: boolean;
}

/**
 * The kinds `sniffV2` tells apart (brief A.6 lines 2178-2186): every
 * `FileKind`, plus a VCF with two or more sample columns, a laboratory
 * genotype table under the header rule, and a PDF — the last is named so the
 * refusal can be the exact `pdf_not_data` sentence rather than
 * `unrecognised_format`.
 */
export type SniffV2Kind = FileKind | "vcf_multisample" | "pgt_table" | "pdf";

export interface SniffV2Result {
  kind: SniffV2Kind | null;
  compressed: boolean;
  /**
   * For a VCF: the number of sample columns after FORMAT on the `#CHROM`
   * line, or null when that line is not within the inspected head. Null for
   * every other kind (a table's sample count is a row property).
   */
  sampleCount: number | null;
  /**
   * The VCF sample column headers, in file order. Transient by contract
   * (register `embryo-ingest-session-v1.identity`): the browser maps each
   * to a server-issued handle in ephemeral memory and nothing persists,
   * logs, renders or sends one. The narrow `sniff` wrapper drops them.
   */
  sampleNames: readonly string[];
}

function startsWithBytes(buf: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => buf[i] === b);
}

/** `%PDF-` (brief line 2194; ADR 0016 closed formats). */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

function decompressHead(bytes: Uint8Array): Uint8Array | null {
  try {
    // Z_SYNC_FLUSH tolerates a truncated trailing member, returning
    // whatever decompressed so far.
    return gunzipSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
  } catch {
    return null;
  }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Detect the file format from the first bytes of a file (a few KB is enough).
 * Handles gzip/bgzf-compressed input by decompressing what it can of the
 * leading member before inspecting the content. Node-only (zlib); browsers
 * use sniffFileV2 from ./sniff-browser, which shares sniffHeadV2 below.
 *
 * Detection order (brief line 2178): BAM/CRAM magic → `%PDF-` → a VCF
 * header, counting the sample columns after `#CHROM` → the four vendor
 * array headers → the laboratory-table header rule → null.
 */
export function sniffV2(bytes: Uint8Array): SniffV2Result {
  const compressed = isGzip(bytes);
  let head = bytes;
  if (compressed) {
    const decompressed = decompressHead(bytes);
    if (!decompressed) return { kind: null, compressed, sampleCount: null, sampleNames: [] };
    head = decompressed;
  }
  return sniffHeadV2(head, compressed);
}

/**
 * The original signature, kept as a thin wrapper over `sniffV2`: a
 * multi-sample VCF still reads as `vcf` here (the subject path's structural
 * validator, not the sniffer, rejects it), and a table or a PDF reads as
 * null, exactly as before.
 */
export function sniff(bytes: Uint8Array): SniffResult {
  return narrow(sniffV2(bytes));
}

/** The V1 view of a V2 answer. */
export function narrow(result: SniffV2Result): SniffResult {
  const kind: FileKind | null =
    result.kind === "vcf_multisample" ? "vcf" : result.kind === "pgt_table" || result.kind === "pdf" ? null : result.kind;
  return { kind, compressed: result.compressed };
}

/** Pure content detection on an already-decompressed head. Runtime-agnostic. */
export function sniffHead(head: Uint8Array, compressed: boolean): SniffResult {
  return narrow(sniffHeadV2(head, compressed));
}

const VCF_FIXED_COLUMNS = 9; // #CHROM POS ID REF ALT QUAL FILTER INFO FORMAT

/** Pure V2 detection on an already-decompressed head. Runtime-agnostic. */
export function sniffHeadV2(head: Uint8Array, compressed: boolean): SniffV2Result {
  const none = { sampleCount: null, sampleNames: [] as readonly string[] };

  // Binary magics: BAM ("BAM\1", inside bgzf) and CRAM ("CRAM", uncompressed).
  if (startsWithBytes(head, [0x42, 0x41, 0x4d, 0x01])) return { kind: "bam", compressed, ...none };
  if (startsWithBytes(head, [0x43, 0x52, 0x41, 0x4d])) return { kind: "cram", compressed, ...none };
  if (startsWithBytes(head, PDF_MAGIC)) return { kind: "pdf", compressed, ...none };

  const text = new TextDecoder().decode(head.subarray(0, 65536));
  const lines = text.split(/\r?\n/);
  const first = lines[0] ?? "";

  if (first.startsWith("##fileformat=VCF")) {
    const single = text.includes("<NON_REF>") ? "gvcf" : "vcf";
    const at = lines.findIndex((line) => line.startsWith("#CHROM"));
    // The header line must be complete: a `#CHROM` line that the decode
    // window (or a truncated gzip member) cut off is the last, unterminated
    // element of the split, and its sample columns cannot be trusted.
    if (at === -1 || at === lines.length - 1) return { kind: single, compressed, ...none };
    const columns = lines[at].replace(/[\t ]+$/, "").split("\t");
    const sampleNames = columns.length > VCF_FIXED_COLUMNS ? columns.slice(VCF_FIXED_COLUMNS) : [];
    const sampleCount = sampleNames.length;
    if (sampleCount >= 2) return { kind: "vcf_multisample", compressed, sampleCount, sampleNames };
    return { kind: single, compressed, sampleCount, sampleNames };
  }
  if (first.startsWith("# This data file generated by 23andMe")) return { kind: "array_23andme", compressed, ...none };
  if (first.startsWith("#AncestryDNA")) return { kind: "array_ancestry", compressed, ...none };
  if (first.startsWith("##fileformat=MyHeritage")) return { kind: "array_myheritage", compressed, ...none };
  // Some MyHeritage exports lack the ##fileformat line and use an unquoted
  // header row (identical to FTDNA's) — but their leading comment block
  // still names the vendor.
  if (lines.some((l) => l.startsWith("#") && /myheritage/i.test(l))) {
    return { kind: "array_myheritage", compressed, ...none };
  }

  // Header-comment-less CSVs: distinguish MyHeritage (quoted) from
  // FamilyTreeDNA (unquoted) by the column-header row.
  const firstData = lines.find((l) => l !== "" && !l.startsWith("#"));
  if (firstData === '"RSID","CHROMOSOME","POSITION","RESULT"') return { kind: "array_myheritage", compressed, ...none };
  if (firstData === "RSID,CHROMOSOME,POSITION,RESULT") return { kind: "array_ftdna", compressed, ...none };

  // A laboratory genotype table: the header rule by exact equality, at
  // least three of the six fields (brief line 2188). The vendor rows above
  // win first, so a consumer export is never re-read as a table.
  if (firstData !== undefined && detectPgtHeader(firstData) !== null) {
    return { kind: "pgt_table", compressed, ...none };
  }

  return { kind: null, compressed, ...none };
}
