// Turn a byte stream (web ReadableStream or Node Readable), possibly
// gzip/bgzf-compressed, into an async iterable of decoded lines.

import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export type ByteSource =
  | ReadableStream<Uint8Array>
  | Readable
  | AsyncIterable<Uint8Array>;

/**
 * Yields decoded UTF-8 lines (without trailing \n or \r\n). Gzip is detected
 * from the leading magic bytes; node:zlib's Gunzip transparently consumes
 * concatenated members, so multi-member gzip and bgzf both work.
 */
export async function* toLines(source: ByteSource): AsyncIterable<string> {
  // Both web ReadableStream (Node >= 16.5) and Node Readable are async
  // iterable at runtime; the DOM typings just don't say so.
  const it = (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();

  // Peek enough bytes to check for the gzip magic (1f 8b).
  const peeked: Uint8Array[] = [];
  let peekedLen = 0;
  let exhausted = false;
  while (peekedLen < 2) {
    const r = await it.next();
    if (r.done) {
      exhausted = true;
      break;
    }
    if (r.value.length > 0) {
      peeked.push(r.value);
      peekedLen += r.value.length;
    }
  }
  const head = Buffer.concat(peeked);
  const gzipped = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;

  async function* bytes(): AsyncGenerator<Uint8Array> {
    if (head.length > 0) yield head;
    if (exhausted) return;
    let r = await it.next();
    while (!r.done) {
      yield r.value;
      r = await it.next();
    }
  }

  const decoded: AsyncIterable<Uint8Array> = gzipped
    ? Readable.from(bytes()).pipe(createGunzip())
    : bytes();

  const decoder = new TextDecoder();
  let carry = "";
  for await (const chunk of decoded) {
    carry += decoder.decode(chunk, { stream: true });
    const parts = carry.split("\n");
    carry = parts.pop() as string;
    for (const p of parts) yield p.endsWith("\r") ? p.slice(0, -1) : p;
  }
  carry += decoder.decode();
  if (carry !== "") yield carry.endsWith("\r") ? carry.slice(0, -1) : carry;
}
