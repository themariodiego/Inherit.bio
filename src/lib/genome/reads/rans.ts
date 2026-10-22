import { ByteReader, unreadable } from "./binary";

/**
 * The rANS 4x8 decoder, CRAM block method 4 (CRAM codecs specification,
 * "rANS4x8", orders 0 and 1). htslib uses it by default when it writes CRAM
 * 3.0, so a reader without it could not open ordinary files. Total frequency
 * is 4096 and states renormalise a byte at a time below 2^23.
 */

const TF_SHIFT = 12;
const TOTFREQ = 1 << TF_SHIFT;
const MASK = TOTFREQ - 1;
const LOWER = 1 << 23;

interface SymbolTable { start: Uint16Array; freq: Uint16Array; lookup: Uint8Array; }

function newTable(): SymbolTable {
  return { start: new Uint16Array(256), freq: new Uint16Array(256), lookup: new Uint8Array(TOTFREQ) };
}

/** One run-length-coded frequency table (shared by both orders). */
function readFrequencies(reader: ByteReader, table: SymbolTable, zeroMeansTotal: boolean) {
  let rle = 0;
  let total = 0;
  let symbol = reader.u8();
  do {
    let frequency = reader.u8();
    if (frequency >= 128) frequency = ((frequency & 0x7f) << 8) | reader.u8();
    if (frequency === 0 && zeroMeansTotal) frequency = TOTFREQ;
    if (total + frequency > TOTFREQ) unreadable();
    table.start[symbol] = total;
    table.freq[symbol] = frequency;
    table.lookup.fill(symbol, total, total + frequency);
    total += frequency;
    if (!rle && symbol + 1 === reader.bytes[reader.offset]) {
      symbol = reader.u8();
      rle = reader.u8();
    } else if (rle) {
      rle--;
      symbol++;
      if (symbol > 255) unreadable();
    } else {
      symbol = reader.u8();
    }
  } while (symbol !== 0);
}

function renormalise(state: number, reader: ByteReader): number {
  let x = state;
  while (x < LOWER) x = ((x << 8) | reader.u8()) >>> 0;
  return x;
}

function advance(state: number, table: SymbolTable, symbol: number): number {
  return table.freq[symbol] * (state >>> TF_SHIFT) + (state & MASK) - table.start[symbol];
}

export function ransDecode4x8(input: Uint8Array): Uint8Array {
  const reader = new ByteReader(input);
  const order = reader.u8();
  const compressedSize = reader.u32();
  const size = reader.u32();
  if (compressedSize !== input.length - 9 || size > 256 * 1024 * 1024) unreadable();
  const out = new Uint8Array(size);
  if (size === 0) return out;
  if (order === 0) {
    const table = newTable();
    readFrequencies(reader, table, false);
    const state = [reader.u32(), reader.u32(), reader.u32(), reader.u32()];
    const end = size & ~3;
    for (let i = 0; i < end; i += 4) {
      for (let k = 0; k < 4; k++) {
        const symbol = table.lookup[state[k] & MASK];
        out[i + k] = symbol;
        state[k] = advance(state[k], table, symbol);
      }
      for (let k = 0; k < 4; k++) state[k] = renormalise(state[k], reader);
    }
    for (let k = (size & 3) - 1; k >= 0; k--) out[end + k] = table.lookup[state[k] & MASK];
    return out;
  }
  if (order !== 1) unreadable();
  const tables = new Map<number, SymbolTable>();
  let rle = 0;
  let context = reader.u8();
  do {
    const table = newTable();
    readFrequencies(reader, table, true);
    tables.set(context, table);
    if (!rle && context + 1 === reader.bytes[reader.offset]) {
      context = reader.u8();
      rle = reader.u8();
    } else if (rle) {
      rle--;
      context++;
      if (context > 255) unreadable();
    } else {
      context = reader.u8();
    }
  } while (context !== 0);
  const table = (previous: number) => tables.get(previous) ?? unreadable();
  const state = [reader.u32(), reader.u32(), reader.u32(), reader.u32()];
  const quarter = size >>> 2;
  const last = [0, 0, 0, 0];
  for (let i = 0; i < quarter; i++) {
    for (let k = 0; k < 4; k++) {
      const current = table(last[k]);
      const symbol = current.lookup[state[k] & MASK];
      out[k * quarter + i] = symbol;
      state[k] = advance(state[k], current, symbol);
      last[k] = symbol;
    }
    for (let k = 0; k < 4; k++) state[k] = renormalise(state[k], reader);
  }
  for (let i = 4 * quarter; i < size; i++) {
    const current = table(last[3]);
    const symbol = current.lookup[state[3] & MASK];
    out[i] = symbol;
    state[3] = renormalise(advance(state[3], current, symbol), reader);
    last[3] = symbol;
  }
  return out;
}
