import { ByteReader, concatBytes, unreadable } from "./binary";
import { bgzfBlocks } from "./bgzf";
import { sequenceDictionary, type AlignedRead, type ReadFileHeader } from "./alignment";

/**
 * A sequential BAM reader (SAM/BAM specification §4.2). It reads the whole
 * file once, front to back, and never needs an index: the caller asks about a
 * fixed set of positions, so every record is looked at once and dropped.
 */

const SEQ_CODES = "=ACMGRSVTWYHKDBN";
const MAGIC = [0x42, 0x41, 0x4d, 0x01];

export interface BamFile {
  header: ReadFileHeader;
  records: AsyncGenerator<AlignedRead>;
}

/** A byte queue over decompressed BGZF payloads. */
class Inflated {
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private done = false;
  constructor(private readonly blocks: AsyncGenerator<Uint8Array>) {}
  /** Ensure at least `count` bytes are buffered; false at a clean end. */
  async fill(count: number): Promise<boolean> {
    while (this.buffer.length - this.offset < count) {
      if (this.done) return false;
      const next = await this.blocks.next();
      if (next.done) { this.done = true; continue; }
      this.buffer = concatBytes([this.buffer.subarray(this.offset), next.value]);
      this.offset = 0;
    }
    return true;
  }
  available(): number { return this.buffer.length - this.offset; }
  take(count: number): Uint8Array {
    const out = this.buffer.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }
}

export async function openBam(source: AsyncIterable<Uint8Array>): Promise<BamFile> {
  const stream = new Inflated(bgzfBlocks(source));
  if (!(await stream.fill(12))) unreadable();
  const magic = stream.take(4);
  if (!MAGIC.every((byte, index) => magic[index] === byte)) unreadable();
  const lText = new ByteReader(stream.take(4)).i32();
  if (lText < 0 || !(await stream.fill(lText + 4))) unreadable();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(stream.take(lText)).replace(/\0+$/, "");
  const nRef = new ByteReader(stream.take(4)).i32();
  if (nRef < 0 || nRef > 100_000) unreadable();
  const dictionary = sequenceDictionary(text);
  const references: ReadFileHeader["references"] = [];
  for (let i = 0; i < nRef; i++) {
    if (!(await stream.fill(4))) unreadable();
    const lName = new ByteReader(stream.take(4)).i32();
    if (lName <= 0 || lName > 4096 || !(await stream.fill(lName + 4))) unreadable();
    const nameBytes = stream.take(lName);
    if (nameBytes[lName - 1] !== 0) unreadable();
    const name = new TextDecoder().decode(nameBytes.subarray(0, lName - 1));
    const length = new ByteReader(stream.take(4)).i32();
    if (length <= 0) unreadable();
    const tags = dictionary.get(name);
    references.push({ name, length, md5: tags?.md5 ?? null, assembly: tags?.assembly ?? null });
  }
  const header: ReadFileHeader = { format: "BAM", text, references };
  async function* records(): AsyncGenerator<AlignedRead> {
    for (;;) {
      if (!(await stream.fill(4))) {
        if (stream.available() !== 0) unreadable();
        return;
      }
      const blockSize = new ByteReader(stream.take(4)).i32();
      if (blockSize < 32 || blockSize > 64 * 1024 * 1024 || !(await stream.fill(blockSize))) unreadable();
      yield decodeRecord(new ByteReader(stream.take(blockSize)), nRef);
    }
  }
  return { header, records: records() };
}

function decodeRecord(reader: ByteReader, nRef: number): AlignedRead {
  const refId = reader.i32();
  const pos = reader.i32();
  const lReadName = reader.u8();
  const mapq = reader.u8();
  reader.u16(); // bin
  const nCigar = reader.u16();
  const flag = reader.u16();
  const lSeq = reader.i32();
  reader.i32(); reader.i32(); reader.i32(); // next refID, next pos, template length
  if (refId < -1 || refId >= nRef || lReadName < 1 || lSeq < 0) unreadable();
  const nameBytes = reader.take(lReadName);
  const name = new TextDecoder().decode(nameBytes.subarray(0, lReadName - 1));
  const cigar: number[] = [];
  for (let i = 0; i < nCigar; i++) cigar.push(reader.u32());
  const packed = reader.take((lSeq + 1) >> 1);
  let seq = "";
  for (let i = 0; i < lSeq; i++) seq += SEQ_CODES[(packed[i >> 1] >> (i % 2 ? 0 : 4)) & 0xf];
  const qual = reader.take(lSeq).slice();
  return { name, flag, refId, pos, mapq, cigar, seq, qual };
}
