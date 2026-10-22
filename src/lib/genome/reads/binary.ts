/**
 * Byte-level helpers shared by the BAM and CRAM readers (G7.4 read calling).
 * Runtime-agnostic: no Node or browser API is used, so the same code runs in
 * the uploader and in the unit suite.
 */

/** Why a sequence-read file could not be read. Closed so the uploader can map
 * each one to a plain sentence; no file content ever travels in a code. */
export type ReadFileFailure =
  | "unreadable_reads"
  | "reference_required"
  | "reference_mismatch"
  | "unsupported_compression"
  | "unsupported_build"
  | "nothing_covered"
  | "too_large";

export class ReadFileError extends Error {
  constructor(readonly code: ReadFileFailure) { super(code); this.name = "ReadFileError"; }
}

export function unreadable(): never { throw new ReadFileError("unreadable_reads"); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, the gzip and CRAM 3.0 checksum). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** A forward cursor over one buffer. Every read past the end is a refusal,
 * never a silent zero. */
export class ByteReader {
  offset: number;
  constructor(readonly bytes: Uint8Array, offset = 0) { this.offset = offset; }
  get remaining(): number { return this.bytes.length - this.offset; }
  private need(count: number) { if (count < 0 || this.offset + count > this.bytes.length) unreadable(); }
  u8(): number { this.need(1); return this.bytes[this.offset++]; }
  i8(): number { const value = this.u8(); return value > 127 ? value - 256 : value; }
  u16(): number { this.need(2); const b = this.bytes, o = this.offset; this.offset += 2; return b[o] | (b[o + 1] << 8); }
  i32(): number {
    this.need(4);
    const b = this.bytes, o = this.offset; this.offset += 4;
    return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  }
  u32(): number { return this.i32() >>> 0; }
  take(count: number): Uint8Array {
    this.need(count);
    const out = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }
  /** CRAM ITF8: a signed 32-bit integer in one to five bytes. */
  itf8(): number {
    const b0 = this.u8();
    if (b0 < 0x80) return b0;
    if (b0 < 0xc0) return ((b0 & 0x3f) << 8) | this.u8();
    if (b0 < 0xe0) { const b1 = this.u8(), b2 = this.u8(); return ((b0 & 0x1f) << 16) | (b1 << 8) | b2; }
    if (b0 < 0xf0) {
      const b1 = this.u8(), b2 = this.u8(), b3 = this.u8();
      return ((b0 & 0x0f) << 24) | (b1 << 16) | (b2 << 8) | b3;
    }
    const b1 = this.u8(), b2 = this.u8(), b3 = this.u8(), b4 = this.u8();
    return ((b0 & 0x0f) << 28) | (b1 << 20) | (b2 << 12) | (b3 << 4) | (b4 & 0x0f);
  }
  /** CRAM LTF8: an integer in one to nine bytes. Values above 2^53 refuse. */
  ltf8(): number {
    const b0 = this.u8();
    let extra = 0;
    while (extra < 8 && (b0 & (0x80 >> extra))) extra++;
    let value = extra >= 7 ? 0 : b0 & (0xff >> (extra + 1));
    for (let i = 0; i < extra; i++) value = value * 256 + this.u8();
    if (!Number.isSafeInteger(value)) unreadable();
    return value;
  }
}

/** Writers used only by the in-repository file generator and its tests. */
export function itf8Bytes(value: number): number[] {
  const v = value >>> 0;
  if (v < 0x80) return [v];
  if (v < 0x4000) return [0x80 | (v >>> 8), v & 0xff];
  if (v < 0x200000) return [0xc0 | (v >>> 16), (v >>> 8) & 0xff, v & 0xff];
  if (v < 0x10000000) return [0xe0 | (v >>> 24), (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  return [0xf0 | (v >>> 28), (v >>> 20) & 0xff, (v >>> 12) & 0xff, (v >>> 4) & 0xff, v & 0x0f];
}

export function ltf8Bytes(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("ltf8");
  if (value < 0x80) return [value];
  if (value < 0x4000) return [0x80 | (value >>> 8), value & 0xff];
  if (value < 0x200000) return [0xc0 | (value >>> 16), (value >>> 8) & 0xff, value & 0xff];
  if (value < 0x10000000) return [0xe0 | (value >>> 24), (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  // Five-byte form: 3 high bits in the first byte, then four bytes.
  if (value < 2 ** 35) {
    const high = Math.floor(value / 2 ** 32);
    const low = value >>> 0;
    return [0xf0 | high, low >>> 24, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff];
  }
  throw new RangeError("ltf8");
}

export function int32Bytes(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
