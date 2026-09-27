import { createCRC32 } from "hash-wasm";

/** Mirror of payloadBoundaryContract.ownZipPreflightMaximumBytes. Local
 * archive processing retains a bounded Blob before the normal upload; this
 * additional browser-memory bound never raises a server ceiling (ADR-0031). */
export const MAXIMUM_LOCAL_ZIP_BYTES = 64 * 1024 * 1024;
export class OwnUploadZipError extends Error {
  constructor(readonly code: "archive_invalid" | "too_large", readonly limitBytes?: number) { super(code); }
}
const invalid = (): never => { throw new OwnUploadZipError("archive_invalid"); };
const u16 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
const u32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

export function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8));
}

async function read(file: Blob, offset: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > file.size) invalid();
  const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  if (bytes.length !== length) invalid();
  return bytes;
}

function checkExtra(bytes: Uint8Array) {
  for (let at = 0; at < bytes.length;) {
    if (at + 4 > bytes.length) invalid();
    // ZIP64 has a different size/offset contract; never silently use its
    // 32-bit sentinel values or accept a conflicting second size.
    if (u16(bytes, at) === 1) invalid();
    at += 4 + u16(bytes, at + 2);
    if (at > bytes.length) invalid();
  }
}

/** Single ordinary file, stored or deflated, including streamed descriptors.
 * PKWARE APPNOTE 6.3.10 sections 4.3.7–4.3.16. No path is extracted to disk;
 * names and archive comments are neither returned nor used as authority. */
async function entry(file: Blob) {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = await read(file, tailStart, file.size - tailStart);
  const endings: number[] = [];
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) === 0x06054b50 && at + 22 + u16(tail, at + 20) === tail.length) endings.push(at);
  }
  if (endings.length !== 1) invalid();
  const end = endings[0];
  if (u16(tail, end + 4) !== 0 || u16(tail, end + 6) !== 0
    || u16(tail, end + 8) !== 1 || u16(tail, end + 10) !== 1) invalid();
  const centralSize = u32(tail, end + 12), centralOffset = u32(tail, end + 16);
  if (centralSize < 46 || centralSize > 46 + 3 * 65535 || centralOffset + centralSize !== tailStart + end) invalid();
  const central = await read(file, centralOffset, centralSize);
  if (u32(central, 0) !== 0x02014b50 || u16(central, 6) > 20 || u16(central, 34) !== 0 || u32(central, 42) !== 0) invalid();
  const flags = u16(central, 8), method = u16(central, 10), crc = u32(central, 16);
  const compressed = u32(central, 20), decoded = u32(central, 24);
  const nameLength = u16(central, 28), extraLength = u16(central, 30), commentLength = u16(central, 32);
  const external = u32(central, 38), unixType = (external >>> 16) & 0xf000;
  if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method) || decoded === 0 || compressed === 0
    || !nameLength || (external & 0x10) !== 0 || (unixType !== 0 && unixType !== 0x8000)
    || 46 + nameLength + extraLength + commentLength !== centralSize) invalid();
  const name = central.subarray(46, 46 + nameLength);
  if (name.includes(0) || name.at(-1) === 0x2f) invalid();
  checkExtra(central.subarray(46 + nameLength, 46 + nameLength + extraLength));
  const local = await read(file, 0, 30);
  if (u32(local, 0) !== 0x04034b50 || u16(local, 4) !== u16(central, 6)
    || u16(local, 6) !== flags || u16(local, 8) !== method || u16(local, 26) !== nameLength) invalid();
  const localExtraLength = u16(local, 28), dataOffset = 30 + nameLength + localExtraLength;
  const localVariable = await read(file, 30, nameLength + localExtraLength);
  if (name.some((byte, at) => byte !== localVariable[at])) invalid();
  checkExtra(localVariable.subarray(nameLength));
  const descriptor = (flags & 8) !== 0;
  for (const [offset, expected] of [[14, crc], [18, compressed], [22, decoded]]) {
    const actual = u32(local, offset);
    if (actual !== expected && !(descriptor && actual === 0)) invalid();
  }
  const dataEnd = dataOffset + compressed;
  if (!descriptor) {
    if (dataEnd !== centralOffset) invalid();
  } else {
    const size = centralOffset - dataEnd;
    if (size !== 12 && size !== 16) invalid();
    const values = await read(file, dataEnd, size), start = size === 16 ? 4 : 0;
    if ((start && u32(values, 0) !== 0x08074b50) || u32(values, start) !== crc
      || u32(values, start + 4) !== compressed || u32(values, start + 8) !== decoded) invalid();
  }
  if (method === 0 && compressed !== decoded) invalid();
  return { dataOffset, compressed, decoded, method, crc };
}

/** Open an archive locally. The caller must still detect and validate the
 * contained DNA format and apply its own exact limit before issuing a lease.
 * The returned File is the source that will be hashed, stored and downloaded. */
export async function openOwnUploadZip(file: File, maximumBytes: number): Promise<File> {
  const limit = Math.min(maximumBytes, MAXIMUM_LOCAL_ZIP_BYTES);
  if (!Number.isSafeInteger(limit) || limit <= 0) invalid();
  if (file.size > MAXIMUM_LOCAL_ZIP_BYTES) throw new OwnUploadZipError("too_large", MAXIMUM_LOCAL_ZIP_BYTES);
  try {
    const info = await entry(file);
    if (info.decoded > limit) throw new OwnUploadZipError("too_large", limit);
    const encoded = file.slice(info.dataOffset, info.dataOffset + info.compressed).stream();
    const decoded = info.method === 8 ? encoded.pipeThrough(new DecompressionStream("deflate-raw")) : encoded;
    const crc = await createCRC32(), reader = decoded.getReader();
    const chunks: BlobPart[] = [];
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > limit) throw new OwnUploadZipError("too_large", limit);
        if (length > info.decoded) invalid();
        crc.update(next.value);
        chunks.push(next.value as BlobPart);
      }
      if (length !== info.decoded || parseInt(crc.digest("hex"), 16) !== info.crc) invalid();
      return new File(chunks, "raw-dna-data", { type: "application/octet-stream" });
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof OwnUploadZipError) throw error;
    return invalid();
  }
}
