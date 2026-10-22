import { ByteReader, concatBytes, crc32, ReadFileError, unreadable } from "./binary";
import { gunzipMember } from "./bgzf";
import { ransDecode4x8 } from "./rans";
import { CIGAR, sequenceDictionary, type AlignedRead, type ReadFileHeader, type ReferenceSequence } from "./alignment";

/**
 * A sequential CRAM 3.x reader (CRAM format specification v3.1, sections 6 to
 * 10). It decodes every container front to back without an index. Blocks may
 * be stored raw, gzip or rANS 4x8 (methods 0, 1 and 4): what htslib writes
 * for CRAM 3.0 by default. Any other block method is refused with
 * `unsupported_compression` rather than guessed.
 *
 * A CRAM stores each read as differences from the reference it was made
 * against, so the bases cannot be rebuilt without that exact reference. The
 * caller supplies it; `openCram` checks every `@SQ` M5 the reads use against
 * it before any read is decoded.
 */

/** Returns the upper-case bases of one reference sequence, or null. */
export type ReferenceLookup = (reference: ReferenceSequence) => string | null;

export interface CramFile {
  header: ReadFileHeader;
  records: AsyncGenerator<AlignedRead>;
}

const CONTENT = { fileHeader: 0, compressionHeader: 1, sliceHeader: 2, external: 4, core: 5 } as const;

/** A byte queue over the raw (uncompressed) CRAM stream. */
class RawStream {
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private ended = false;
  private readonly iterator: AsyncIterator<Uint8Array>;
  constructor(source: AsyncIterable<Uint8Array>) { this.iterator = source[Symbol.asyncIterator](); }
  async fill(count: number): Promise<boolean> {
    while (this.buffer.length - this.offset < count) {
      if (this.ended) return false;
      const next = await this.iterator.next();
      if (next.done) { this.ended = true; continue; }
      this.buffer = concatBytes([this.buffer.subarray(this.offset), next.value]);
      this.offset = 0;
    }
    return true;
  }
  /** Fill what the source has, up to `count` more bytes. */
  async fillUpTo(count: number): Promise<void> { await this.fill(this.available() + count); }
  available(): number { return this.buffer.length - this.offset; }
  get isEnded(): boolean { return this.ended; }
  view(): Uint8Array { return this.buffer.subarray(this.offset); }
  take(count: number): Uint8Array {
    const out = this.buffer.subarray(this.offset, this.offset + count);
    this.offset += count;
    return out;
  }
}

interface ContainerHeader { length: number; refId: number; nRecords: number; nBlocks: number; landmarks: number[]; }

function parseContainerHeader(bytes: Uint8Array): { header: ContainerHeader; size: number } {
  const reader = new ByteReader(bytes);
  const length = reader.i32();
  const refId = reader.itf8();
  reader.itf8(); reader.itf8(); // start, span
  const nRecords = reader.itf8();
  reader.ltf8(); reader.ltf8(); // record counter, bases
  const nBlocks = reader.itf8();
  const nLandmarks = reader.itf8();
  if (length < 0 || nRecords < 0 || nBlocks < 0 || nLandmarks < 0 || nLandmarks > 100_000) unreadable();
  const landmarks: number[] = [];
  for (let i = 0; i < nLandmarks; i++) landmarks.push(reader.itf8());
  const crcEnd = reader.offset;
  const crc = reader.u32();
  if (crc !== crc32(bytes, 0, crcEnd)) unreadable();
  return { header: { length, refId, nRecords, nBlocks, landmarks }, size: reader.offset };
}

interface Block { method: number; contentType: number; contentId: number; data: Uint8Array; }

async function readBlock(reader: ByteReader): Promise<Block> {
  const start = reader.offset;
  const method = reader.u8();
  const contentType = reader.u8();
  const contentId = reader.itf8();
  const size = reader.itf8();
  const rawSize = reader.itf8();
  if (size < 0 || rawSize < 0 || rawSize > 256 * 1024 * 1024) unreadable();
  const stored = reader.take(size);
  const crcEnd = reader.offset;
  if (reader.u32() !== crc32(reader.bytes, start, crcEnd)) unreadable();
  let data: Uint8Array;
  if (method === 0) data = stored;
  else if (method === 1) data = await gunzipMember(stored);
  else if (method === 4) data = ransDecode4x8(stored);
  else throw new ReadFileError("unsupported_compression");
  if (data.length !== rawSize) unreadable();
  return { method, contentType, contentId, data };
}

// ---------------------------------------------------------------------------
// Encodings (specification section 13)
// ---------------------------------------------------------------------------

interface Encoding { codec: number; params: Uint8Array; }

function readEncoding(reader: ByteReader): Encoding {
  const codec = reader.itf8();
  const size = reader.itf8();
  return { codec, params: reader.take(size) };
}

class BitReader {
  private byte = 0;
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (this.byte >= this.bytes.length) unreadable();
      value = value * 2 + ((this.bytes[this.byte] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.byte++; }
    }
    return value;
  }
}

interface SliceStreams { core: BitReader; external: Map<number, ByteReader>; }

function external(streams: SliceStreams, id: number): ByteReader {
  const block = streams.external.get(id);
  if (!block) unreadable();
  return block;
}

type IntDecoder = (streams: SliceStreams) => number;
type BytesDecoder = (streams: SliceStreams) => Uint8Array;

function huffman(params: ByteReader): IntDecoder {
  const alphabet: number[] = [];
  for (let i = 0, n = params.itf8(); i < n; i++) alphabet.push(params.itf8());
  const lengths: number[] = [];
  for (let i = 0, n = params.itf8(); i < n; i++) lengths.push(params.itf8());
  if (!alphabet.length || alphabet.length !== lengths.length) unreadable();
  if (alphabet.length === 1 && lengths[0] === 0) { const only = alphabet[0]; return () => only; }
  const order = alphabet.map((symbol, index) => ({ symbol, length: lengths[index] }))
    .sort((a, b) => a.length - b.length || a.symbol - b.symbol);
  const table = new Map<string, number>();
  let code = 0, previous = order[0].length;
  for (const entry of order) {
    if (entry.length < 1 || entry.length > 31) unreadable();
    code = code * 2 ** (entry.length - previous);
    previous = entry.length;
    table.set(`${entry.length}:${code}`, entry.symbol);
    code++;
  }
  const maximum = order[order.length - 1].length;
  return (streams) => {
    let value = 0;
    for (let length = 1; length <= maximum; length++) {
      value = value * 2 + streams.core.read(1);
      const symbol = table.get(`${length}:${value}`);
      if (symbol !== undefined) return symbol;
    }
    return unreadable();
  };
}

function intDecoder(encoding: Encoding): IntDecoder {
  const params = new ByteReader(encoding.params);
  switch (encoding.codec) {
    case 1: { const id = params.itf8(); return (streams) => external(streams, id).itf8(); }
    case 3: return huffman(params);
    case 6: {
      const offset = params.itf8(), bits = params.itf8();
      return (streams) => streams.core.read(bits) - offset;
    }
    case 7: {
      const offset = params.itf8(), k = params.itf8();
      return (streams) => {
        let unary = 0;
        while (streams.core.read(1) === 1) unary++;
        const value = unary === 0 ? streams.core.read(k)
          : 2 ** (unary + k - 1) + streams.core.read(unary + k - 1);
        return value - offset;
      };
    }
    case 9: {
      const offset = params.itf8();
      return (streams) => {
        let zeros = 0;
        while (streams.core.read(1) === 0) zeros++;
        return 2 ** zeros + streams.core.read(zeros) - offset;
      };
    }
    default: throw new ReadFileError("unsupported_compression");
  }
}

function byteDecoder(encoding: Encoding): IntDecoder {
  if (encoding.codec === 1) {
    const id = new ByteReader(encoding.params).itf8();
    return (streams) => external(streams, id).u8();
  }
  return intDecoder(encoding);
}

function bytesDecoder(encoding: Encoding): BytesDecoder {
  const params = new ByteReader(encoding.params);
  if (encoding.codec === 4) {
    const length = intDecoder(readEncoding(params));
    const valuesEncoding = readEncoding(params);
    if (valuesEncoding.codec === 1) {
      const id = new ByteReader(valuesEncoding.params).itf8();
      return (streams) => {
        const count = length(streams);
        if (count < 0) unreadable();
        return external(streams, id).take(count);
      };
    }
    const value = byteDecoder(valuesEncoding);
    return (streams) => {
      const count = length(streams);
      if (count < 0) unreadable();
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i++) out[i] = value(streams);
      return out;
    };
  }
  if (encoding.codec === 5) {
    const stop = params.u8();
    const id = params.itf8();
    return (streams) => {
      const block = external(streams, id);
      const start = block.offset;
      while (block.u8() !== stop) { /* consume to the stop byte */ }
      return block.bytes.subarray(start, block.offset - 1);
    };
  }
  throw new ReadFileError("unsupported_compression");
}

// ---------------------------------------------------------------------------
// Compression header (section 8.4)
// ---------------------------------------------------------------------------

const BASES = "ACGTN";

interface CompressionHeader {
  readNamesIncluded: boolean;
  apDelta: boolean;
  referenceRequired: boolean;
  substitution: string[][];
  tagLines: number[][];
  series: Map<string, Encoding>;
  tags: Map<number, Encoding>;
}

function substitutionMatrix(bytes: Uint8Array): string[][] {
  return BASES.split("").map((ref, row) => {
    const others = BASES.split("").filter((base) => base !== ref);
    const out: string[] = ["N", "N", "N", "N"];
    others.forEach((base, index) => { out[(bytes[row] >> (6 - 2 * index)) & 3] = base; });
    return out;
  });
}

function parseCompressionHeader(data: Uint8Array): CompressionHeader {
  const reader = new ByteReader(data);
  const header: CompressionHeader = {
    readNamesIncluded: true, apDelta: true, referenceRequired: true,
    substitution: substitutionMatrix(Uint8Array.from([0x1b, 0x1b, 0x1b, 0x1b, 0x1b])),
    tagLines: [[]], series: new Map(), tags: new Map(),
  };
  reader.itf8();
  for (let i = 0, n = reader.itf8(); i < n; i++) {
    const key = String.fromCharCode(reader.u8(), reader.u8());
    if (key === "RN") header.readNamesIncluded = reader.u8() !== 0;
    else if (key === "AP") header.apDelta = reader.u8() !== 0;
    else if (key === "RR") header.referenceRequired = reader.u8() !== 0;
    else if (key === "SM") header.substitution = substitutionMatrix(reader.take(5));
    else if (key === "TD") {
      const dictionary = reader.take(reader.itf8());
      header.tagLines = [];
      let line: number[] = [];
      for (let at = 0; at < dictionary.length;) {
        if (dictionary[at] === 0) { header.tagLines.push(line); line = []; at++; continue; }
        if (at + 3 > dictionary.length) unreadable();
        line.push((dictionary[at] << 16) | (dictionary[at + 1] << 8) | dictionary[at + 2]);
        at += 3;
      }
      if (line.length) header.tagLines.push(line);
      if (!header.tagLines.length) header.tagLines = [[]];
    } else unreadable();
  }
  reader.itf8();
  for (let i = 0, n = reader.itf8(); i < n; i++) {
    const key = String.fromCharCode(reader.u8(), reader.u8());
    header.series.set(key, readEncoding(reader));
  }
  reader.itf8();
  for (let i = 0, n = reader.itf8(); i < n; i++) {
    const key = reader.itf8();
    header.tags.set(key, readEncoding(reader));
  }
  return header;
}

// ---------------------------------------------------------------------------
// Slices and records (sections 8.5 and 10)
// ---------------------------------------------------------------------------

interface SeriesDecoders {
  int: (key: string) => IntDecoder;
  byte: (key: string) => IntDecoder;
  bytes: (key: string) => BytesDecoder;
  tag: (id: number) => BytesDecoder;
}

function seriesDecoders(header: CompressionHeader): SeriesDecoders {
  const cache = new Map<string, unknown>();
  function cached<T>(key: string, make: () => T): T {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key) as T;
  }
  const encoding = (key: string) => {
    const found = header.series.get(key);
    if (!found) unreadable();
    return found;
  };
  return {
    int: (key) => cached(`i${key}`, () => intDecoder(encoding(key))),
    byte: (key) => cached(`b${key}`, () => byteDecoder(encoding(key))),
    bytes: (key) => cached(`a${key}`, () => bytesDecoder(encoding(key))),
    tag: (id) => cached(`t${id}`, () => {
      const found = header.tags.get(id);
      if (!found) unreadable();
      return bytesDecoder(found);
    }),
  };
}

function pushCigar(cigar: number[], op: number, length: number) {
  if (length <= 0) return;
  const last = cigar[cigar.length - 1];
  if (last !== undefined && (last & 0xf) === op) cigar[cigar.length - 1] = (((last >>> 4) + length) << 4) | op;
  else cigar.push((length << 4) | op);
}

async function* decodeSlice(sliceHeader: Block, blocks: Block[], header: CompressionHeader,
  decoders: SeriesDecoders, references: ReferenceSequence[], lookup: ReferenceLookup | null): AsyncGenerator<AlignedRead> {
  const reader = new ByteReader(sliceHeader.data);
  const sliceRefId = reader.itf8();
  const sliceStart = reader.itf8();
  const sliceSpan = reader.itf8();
  const nRecords = reader.itf8();
  reader.ltf8();
  reader.itf8(); // number of blocks
  for (let i = 0, n = reader.itf8(); i < n; i++) reader.itf8();
  const embeddedRefId = reader.itf8();
  let core: Uint8Array = new Uint8Array(0);
  const externalBlocks = new Map<number, ByteReader>();
  let embedded: string | null = null;
  for (const block of blocks) {
    if (block.contentType === CONTENT.core) core = block.data;
    else if (block.contentType === CONTENT.external) {
      externalBlocks.set(block.contentId, new ByteReader(block.data));
      if (embeddedRefId >= 0 && block.contentId === embeddedRefId) embedded = new TextDecoder().decode(block.data).toUpperCase();
    } else unreadable();
  }
  const streams: SliceStreams = { core: new BitReader(core), external: externalBlocks };
  const sequences = new Map<number, string | null>();
  function referenceBase(refId: number, position1: number): string {
    if (embedded !== null && refId === sliceRefId) {
      const at = position1 - sliceStart;
      return at >= 0 && at < embedded.length && at < sliceSpan ? embedded[at] : "N";
    }
    if (!header.referenceRequired) return "N";
    if (!sequences.has(refId)) {
      const reference = references[refId];
      sequences.set(refId, reference && lookup ? lookup(reference) : null);
    }
    const bases = sequences.get(refId);
    if (bases === null || bases === undefined) throw new ReadFileError("reference_required");
    return bases[position1 - 1] ?? "N";
  }
  const int = decoders.int, byte = decoders.byte, bytes = decoders.bytes;
  let previousPosition = sliceStart;
  for (let index = 0; index < nRecords; index++) {
    const flag = int("BF")(streams);
    const cramFlags = int("CF")(streams);
    const refId = sliceRefId === -2 ? int("RI")(streams) : sliceRefId;
    const readLength = int("RL")(streams);
    let position = int("AP")(streams);
    if (header.apDelta) { position += previousPosition; previousPosition = position; }
    int("RG")(streams);
    let name = `cram-${index}`;
    if (header.readNamesIncluded) name = new TextDecoder().decode(bytes("RN")(streams));
    if (cramFlags & 0x2) {
      int("MF")(streams);
      if (!header.readNamesIncluded) name = new TextDecoder().decode(bytes("RN")(streams));
      int("NS")(streams); int("NP")(streams); int("TS")(streams);
    } else if (cramFlags & 0x4) {
      int("NF")(streams);
    }
    const tagLine = header.tagLines[int("TL")(streams)];
    if (!tagLine) unreadable();
    for (const tag of tagLine) decoders.tag(tag)(streams);
    if (readLength < 0 || readLength > 10_000_000) unreadable();
    const qual = new Uint8Array(readLength).fill(255);
    if (flag & 0x4) {
      if (!(cramFlags & 0x8)) for (let i = 0; i < readLength; i++) byte("BA")(streams);
      if (cramFlags & 0x1) for (let i = 0; i < readLength; i++) qual[i] = byte("QS")(streams);
      continue; // Unmapped reads carry nothing the caller reads.
    }
    const featureCount = int("FN")(streams);
    const bases: string[] = new Array(readLength);
    const cigar: number[] = [];
    let readPos = 0, refPos = position, featurePosition = 0;
    const copyReference = (count: number) => {
      for (let i = 0; i < count; i++) bases[readPos + i] = referenceBase(refId, refPos + i);
      pushCigar(cigar, CIGAR.M, count);
      readPos += count; refPos += count;
    };
    for (let f = 0; f < featureCount; f++) {
      const code = String.fromCharCode(byte("FC")(streams));
      featurePosition += int("FP")(streams);
      const gap = featurePosition - 1 - readPos;
      if (gap < 0 && !"qQ".includes(code)) unreadable();
      if (gap > 0 && !"qQ".includes(code)) copyReference(gap);
      switch (code) {
        case "X": {
          const ref = referenceBase(refId, refPos);
          const row = BASES.indexOf(ref);
          bases[readPos] = header.substitution[row < 0 ? 4 : row][byte("BS")(streams)];
          pushCigar(cigar, CIGAR.M, 1); readPos++; refPos++;
          break;
        }
        case "B": {
          bases[readPos] = String.fromCharCode(byte("BA")(streams));
          qual[readPos] = byte("QS")(streams);
          pushCigar(cigar, CIGAR.M, 1); readPos++; refPos++;
          break;
        }
        case "b": {
          const run = bytes("BB")(streams);
          for (let i = 0; i < run.length; i++) bases[readPos + i] = String.fromCharCode(run[i]);
          pushCigar(cigar, CIGAR.M, run.length); readPos += run.length; refPos += run.length;
          break;
        }
        case "I": case "S": {
          const run = bytes(code === "I" ? "IN" : "SC")(streams);
          for (let i = 0; i < run.length; i++) bases[readPos + i] = String.fromCharCode(run[i]);
          pushCigar(cigar, code === "I" ? CIGAR.I : CIGAR.S, run.length); readPos += run.length;
          break;
        }
        case "i": {
          bases[readPos] = String.fromCharCode(byte("BA")(streams));
          pushCigar(cigar, CIGAR.I, 1); readPos++;
          break;
        }
        case "D": case "N": {
          const length = int(code === "D" ? "DL" : "RS")(streams);
          pushCigar(cigar, code === "D" ? CIGAR.D : CIGAR.N, length); refPos += length;
          break;
        }
        case "P": pushCigar(cigar, CIGAR.P, int("PD")(streams)); break;
        case "H": pushCigar(cigar, CIGAR.H, int("HC")(streams)); break;
        case "Q": qual[featurePosition - 1] = byte("QS")(streams); break;
        case "q": {
          const run = bytes("QQ")(streams);
          for (let i = 0; i < run.length; i++) qual[featurePosition - 1 + i] = run[i];
          break;
        }
        default: unreadable();
      }
      if (readPos > readLength) unreadable();
    }
    if (readPos < readLength) copyReference(readLength - readPos);
    const mapq = int("MQ")(streams);
    if (cramFlags & 0x1) for (let i = 0; i < readLength; i++) qual[i] = byte("QS")(streams);
    yield { name, flag, refId, pos: position - 1, mapq, cigar, seq: bases.join("").toUpperCase(), qual };
  }
}

export async function openCram(source: AsyncIterable<Uint8Array>, lookup: ReferenceLookup | null): Promise<CramFile> {
  const stream = new RawStream(source);
  if (!(await stream.fill(26))) unreadable();
  const definition = stream.take(26);
  if (String.fromCharCode(...definition.subarray(0, 4)) !== "CRAM") unreadable();
  if (definition[4] !== 3) throw new ReadFileError("unsupported_compression");

  async function nextContainer(): Promise<{ header: ContainerHeader; data: Uint8Array } | null> {
    if (!(await stream.fill(1))) return null;
    for (let want = 64; ; want *= 4) {
      await stream.fill(Math.min(want, stream.available() + want));
      try {
        const parsed = parseContainerHeader(stream.view());
        stream.take(parsed.size);
        if (!(await stream.fill(parsed.header.length))) unreadable();
        return { header: parsed.header, data: stream.take(parsed.header.length) };
      } catch (error) {
        if (stream.isEnded || want > 1 << 20) throw error;
      }
    }
  }
  const first = await nextContainer();
  if (!first) unreadable();
  const firstBlock = await readBlock(new ByteReader(first.data));
  if (firstBlock.contentType !== CONTENT.fileHeader) unreadable();
  const textReader = new ByteReader(firstBlock.data);
  const lText = textReader.i32();
  const text = new TextDecoder().decode(textReader.take(lText)).replace(/\0+$/, "");
  const dictionary = sequenceDictionary(text);
  const references: ReferenceSequence[] = [...dictionary.entries()].map(([name, tags]) => ({ name, ...tags }));
  const header: ReadFileHeader = { format: "CRAM", text, references };

  async function* records(): AsyncGenerator<AlignedRead> {
    for (;;) {
      const container = await nextContainer();
      if (!container) return;
      if (container.header.nRecords === 0) continue; // the EOF container, or an empty one
      const reader = new ByteReader(container.data);
      const compression = await readBlock(reader);
      if (compression.contentType !== CONTENT.compressionHeader) unreadable();
      const parsed = parseCompressionHeader(compression.data);
      const decoders = seriesDecoders(parsed);
      for (const landmark of container.header.landmarks) {
        const sliceReader = new ByteReader(container.data, landmark);
        const sliceHeader = await readBlock(sliceReader);
        if (sliceHeader.contentType !== CONTENT.sliceHeader) unreadable();
        const count = new ByteReader(sliceHeader.data);
        count.itf8(); count.itf8(); count.itf8(); count.itf8(); count.ltf8();
        const nBlocks = count.itf8();
        const blocks: Block[] = [];
        for (let i = 0; i < nBlocks; i++) blocks.push(await readBlock(sliceReader));
        yield* decodeSlice(sliceHeader, blocks, parsed, decoders, references, lookup);
      }
    }
  }
  return { header, records: records() };
}
