import { concatBytes, crc32, ReadFileError, unreadable } from "./binary";

/**
 * BGZF (SAM/BAM specification §4.1): a series of gzip members, each carrying
 * its compressed size in a `BC` extra subfield. Each member is inflated on its
 * own, because a browser's `DecompressionStream` refuses data after the first
 * gzip member. The same Web API exists in Node 22, so one code path serves the
 * uploader and the unit suite.
 */

/** Inflate one raw DEFLATE stream (RFC 1951). */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  } catch { unreadable(); }
  return concatBytes(parts);
}

/** Inflate one zlib-free gzip member's payload (CRAM block method 1 is a gzip
 * member, not raw DEFLATE). Header fields are skipped per RFC 1952. */
export async function gunzipMember(member: Uint8Array): Promise<Uint8Array> {
  if (member.length < 18 || member[0] !== 0x1f || member[1] !== 0x8b || member[2] !== 8) unreadable();
  const flags = member[3];
  let offset = 10;
  if (flags & 0x04) { const xlen = member[offset] | (member[offset + 1] << 8); offset += 2 + xlen; }
  if (flags & 0x08) { while (offset < member.length && member[offset] !== 0) offset++; offset++; }
  if (flags & 0x10) { while (offset < member.length && member[offset] !== 0) offset++; offset++; }
  if (flags & 0x02) offset += 2;
  if (offset > member.length - 8) unreadable();
  const payload = await inflateRaw(member.subarray(offset, member.length - 8));
  const tail = member.length - 8;
  const expectedCrc = (member[tail] | (member[tail + 1] << 8) | (member[tail + 2] << 16) | (member[tail + 3] << 24)) >>> 0;
  const expectedSize = (member[tail + 4] | (member[tail + 5] << 8) | (member[tail + 6] << 16) | (member[tail + 7] << 24)) >>> 0;
  if (payload.length >>> 0 !== expectedSize || crc32(payload) !== expectedCrc) unreadable();
  return payload;
}

/** True when the bytes open with a BGZF member header (gzip + FEXTRA + `BC`). */
export function isBgzf(head: Uint8Array): boolean {
  return head.length >= 18 && head[0] === 0x1f && head[1] === 0x8b && head[2] === 8 && (head[3] & 0x04) !== 0
    && head[12] === 0x42 && head[13] === 0x43 && head[14] === 2 && head[15] === 0;
}

/**
 * Yields the decompressed payload of every BGZF block, in order. Each block's
 * CRC32 and size are checked. A stream that is not BGZF, is truncated, or
 * whose blocks disagree with their own trailers is refused.
 */
export async function* bgzfBlocks(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let pending: Uint8Array = new Uint8Array(0);
  let sawBlock = false;
  for await (const chunk of source) {
    pending = pending.length ? concatBytes([pending, chunk]) : chunk;
    let offset = 0;
    while (pending.length - offset >= 18) {
      if (!isBgzf(pending.subarray(offset, offset + 18))) unreadable();
      const blockSize = (pending[offset + 16] | (pending[offset + 17] << 8)) + 1;
      if (blockSize < 26) unreadable();
      if (pending.length - offset < blockSize) break;
      const member = pending.subarray(offset, offset + blockSize);
      offset += blockSize;
      sawBlock = true;
      const payload = await gunzipMember(member);
      if (payload.length) yield payload;
    }
    pending = pending.slice(offset);
  }
  if (pending.length || !sawBlock) throw new ReadFileError("unreadable_reads");
}

/** A Blob read as bounded chunks, without holding the whole file. */
export async function* blobChunks(blob: Blob, chunkBytes = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < blob.size; start += chunkBytes) {
    yield new Uint8Array(await blob.slice(start, Math.min(blob.size, start + chunkBytes)).arrayBuffer());
  }
}
