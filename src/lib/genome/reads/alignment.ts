/**
 * The one aligned-read shape both readers produce (SAM/BAM specification
 * §1.4 and §4.2). Positions are 0-based here, as in BAM; the caller converts
 * to the 1-based positions a VCF and the product use.
 */

export const CIGAR_OPS = "MIDNSHP=X";
export const CIGAR = { M: 0, I: 1, D: 2, N: 3, S: 4, H: 5, P: 6, EQ: 7, X: 8 } as const;

/** SAM FLAG bits the caller reads. */
export const FLAG = {
  paired: 0x1, unmapped: 0x4, secondary: 0x100, qcFail: 0x200, duplicate: 0x400, supplementary: 0x800,
} as const;

export interface ReferenceSequence {
  name: string;
  length: number;
  /** The `@SQ` M5 tag: MD5 of the upper-case sequence, when the header has one. */
  md5: string | null;
  /** The `@SQ` AS tag (assembly identifier), when present. */
  assembly: string | null;
}

export interface AlignedRead {
  name: string;
  flag: number;
  refId: number;
  /** 0-based leftmost aligned reference position. */
  pos: number;
  mapq: number;
  /** BAM-encoded CIGAR: length << 4 | op. */
  cigar: readonly number[];
  /** Upper-case ASCII bases (`=` already resolved against the reference). */
  seq: string;
  /** Phred base qualities; 255 means the file stored none. */
  qual: Uint8Array;
}

export interface ReadFileHeader {
  format: "BAM" | "CRAM";
  text: string;
  references: ReferenceSequence[];
}

/** Parse the `@SQ` lines of a SAM header text. */
export function sequenceDictionary(text: string): Map<string, { length: number; md5: string | null; assembly: string | null }> {
  const out = new Map<string, { length: number; md5: string | null; assembly: string | null }>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("@SQ\t")) continue;
    const tags = new Map(line.split("\t").slice(1).map((field) => [field.slice(0, 2), field.slice(3)]));
    const name = tags.get("SN");
    const length = Number(tags.get("LN"));
    if (!name || !Number.isSafeInteger(length) || length <= 0) continue;
    const md5 = tags.get("M5")?.toLowerCase() ?? null;
    out.set(name, { length, md5: md5 && /^[0-9a-f]{32}$/.test(md5) ? md5 : null, assembly: tags.get("AS") ?? null });
  }
  return out;
}

/**
 * The read's base and quality at one reference position, or `deletion` when
 * the alignment spans it with a deletion or skip, or null when the read does
 * not cover it. Soft clips, insertions and padding consume no reference.
 */
export function baseAt(read: AlignedRead, refPos: number): { base: string; quality: number } | "deletion" | null {
  let ref = read.pos;
  let query = 0;
  for (const encoded of read.cigar) {
    const op = encoded & 0xf;
    const length = encoded >>> 4;
    if (op === CIGAR.M || op === CIGAR.EQ || op === CIGAR.X) {
      if (refPos < ref + length) {
        if (refPos < ref) return null;
        const at = query + (refPos - ref);
        if (at >= read.seq.length) return null;
        return { base: read.seq[at], quality: read.qual[at] ?? 255 };
      }
      ref += length; query += length;
    } else if (op === CIGAR.D || op === CIGAR.N) {
      if (refPos < ref + length) return refPos < ref ? null : "deletion";
      ref += length;
    } else if (op === CIGAR.I || op === CIGAR.S) {
      query += length;
    }
    // H and P consume neither.
  }
  return null;
}

/** One past the last reference position the read aligns to (0-based). */
export function alignmentEnd(read: AlignedRead): number {
  let ref = read.pos;
  for (const encoded of read.cigar) {
    const op = encoded & 0xf;
    if (op === CIGAR.M || op === CIGAR.D || op === CIGAR.N || op === CIGAR.EQ || op === CIGAR.X) ref += encoded >>> 4;
  }
  return ref;
}
