// GRCh37 -> GRCh38 point liftover from a UCSC-format chain file
// (Ensembl assembly mapping; chromosome names without "chr" prefix).
//
// Chain header: chain score tName tSize tStrand tStart tEnd qName qSize qStrand qStart qEnd id
// where t* is the source assembly (GRCh37) and q* the target (GRCh38).
// Alignment lines: "size dt dq" (last line of a chain is "size" alone).
// All coordinates are 0-based half-open; q coordinates count along qStrand, so
// for '-' chains the forward-strand position is qSize - 1 - qPos.

import { gunzipSync } from "node:zlib";
import { chromToNumber } from "./types";

interface Block {
  tStart: number; // 0-based source start (forward strand)
  tEnd: number; // exclusive
  qChrom: number;
  qStart: number; // 0-based target start, counted along qStrand
  qNeg: boolean; // target block is on the '-' strand
  qSize: number;
}

interface ChainState {
  tChrom: number;
  tPos: number;
  qChrom: number;
  qPos: number;
  qNeg: boolean;
  qSize: number;
}

export type Liftover = (
  chrom: number,
  pos: number,
) => { chrom: number; pos: number } | null;

/**
 * Parses chain bytes (gzipped or plain text) and returns a point mapper.
 * Input positions are 1-based (VariantRecord.pos); returns 1-based positions,
 * or null when the position falls outside every chain block.
 */
export function buildLiftover(chainBytes: Uint8Array): Liftover {
  const bytes =
    chainBytes[0] === 0x1f && chainBytes[1] === 0x8b
      ? new Uint8Array(gunzipSync(chainBytes))
      : chainBytes;
  const text = new TextDecoder().decode(bytes);

  const byChrom = new Map<number, Block[]>();
  // Current chain state; null while skipping a chain on a scaffold/patch.
  let cur: ChainState | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      cur = null;
      continue;
    }
    const fields = trimmed.split(/\s+/);
    if (fields[0] === "chain") {
      const tChrom = chromToNumber(fields[2]);
      const qChrom = chromToNumber(fields[7]);
      if (tChrom === null || qChrom === null || fields[4] !== "+") {
        cur = null; // scaffold/patch, or unexpected source strand
        continue;
      }
      cur = {
        tChrom,
        tPos: Number(fields[5]),
        qChrom,
        qPos: Number(fields[10]),
        qNeg: fields[9] === "-",
        qSize: Number(fields[8]),
      };
      continue;
    }
    if (cur === null) continue;
    // "size dt dq", or a bare "size" terminating the chain.
    const size = Number(fields[0]);
    let blocks = byChrom.get(cur.tChrom);
    if (!blocks) {
      blocks = [];
      byChrom.set(cur.tChrom, blocks);
    }
    blocks.push({
      tStart: cur.tPos,
      tEnd: cur.tPos + size,
      qChrom: cur.qChrom,
      qStart: cur.qPos,
      qNeg: cur.qNeg,
      qSize: cur.qSize,
    });
    if (fields.length >= 3) {
      cur.tPos += size + Number(fields[1]);
      cur.qPos += size + Number(fields[2]);
    } else {
      cur = null;
    }
  }

  for (const blocks of byChrom.values()) {
    blocks.sort((a, b) => a.tStart - b.tStart);
  }

  return (chrom, pos) => {
    const blocks = byChrom.get(chrom);
    if (!blocks || blocks.length === 0) return null;
    const p = pos - 1; // 1-based -> 0-based
    // Binary search: rightmost block with tStart <= p. Blocks are
    // non-overlapping on the source assembly, so at most one can contain p.
    let lo = 0;
    let hi = blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].tStart <= p) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found === -1) return null;
    const b = blocks[found];
    if (p >= b.tEnd) return null;
    const q = b.qStart + (p - b.tStart); // 0-based, along qStrand
    const forward = b.qNeg ? b.qSize - 1 - q : q;
    return { chrom: b.qChrom, pos: forward + 1 }; // back to 1-based
  };
}
