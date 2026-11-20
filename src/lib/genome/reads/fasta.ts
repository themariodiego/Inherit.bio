import { md5 } from "hash-wasm";
import { ReadFileError } from "./binary";
import type { ReferenceSequence } from "./alignment";

/**
 * A reference FASTA held in memory, for decoding CRAM (SAM specification
 * §1.3.2: an `@SQ` M5 is the MD5 of the sequence in upper case with every
 * non-printing character removed). Bounded on purpose: the whole GRCh38
 * analysis set is about 3.1 GB, which a browser tab cannot hold, so this
 * reader serves small references only. That bound is one of the reasons CRAM
 * calling stays a TEST-LOCAL capability (ADR 0038).
 */

export const MAXIMUM_REFERENCE_BYTES = 64 * 1024 * 1024;

export interface ReferenceGenome {
  sequences: Map<string, { bases: string; md5: string }>;
}

export async function parseFasta(bytes: Uint8Array): Promise<ReferenceGenome> {
  if (bytes.length > MAXIMUM_REFERENCE_BYTES) throw new ReadFileError("too_large");
  const text = new TextDecoder("ascii").decode(bytes);
  if (!text.startsWith(">")) throw new ReadFileError("reference_mismatch");
  const sequences = new Map<string, { bases: string; md5: string }>();
  for (const record of text.split(/\r?\n(?=>)/)) {
    const newline = record.indexOf("\n");
    const name = (newline === -1 ? record : record.slice(0, newline)).slice(1).trim().split(/\s+/)[0];
    const bases = (newline === -1 ? "" : record.slice(newline + 1)).replace(/[^\x21-\x7e]/g, "").toUpperCase();
    if (!name || sequences.has(name) || !/^[A-Z*-]*$/.test(bases)) throw new ReadFileError("reference_mismatch");
    sequences.set(name, { bases, md5: await md5(bases) });
  }
  return { sequences };
}

/** True when the bytes open like a FASTA file. */
export function looksLikeFasta(head: Uint8Array): boolean {
  return head.length > 1 && head[0] === 0x3e && head[1] > 0x20;
}

/**
 * The reference lookup a CRAM read needs, after checking that every sequence
 * the file declares is present with the length and MD5 the file states. A
 * sequence without an M5 cannot be matched honestly and refuses.
 */
export function referenceLookup(genome: ReferenceGenome, declared: readonly ReferenceSequence[]) {
  for (const reference of declared) {
    const found = genome.sequences.get(reference.name);
    if (!reference.md5 || !found || found.bases.length !== reference.length || found.md5 !== reference.md5) {
      throw new ReadFileError("reference_mismatch");
    }
  }
  return (reference: ReferenceSequence) => genome.sequences.get(reference.name)?.bases ?? null;
}
