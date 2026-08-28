// Browser-side format sniffing for the uploader: decompresses a gzip head
// with DecompressionStream (tolerating truncation — we only hold the first
// ~256 KB of the file) and delegates to the shared pure detector.

import { sniffHead, type SniffResult } from "./sniff";

export async function sniffFile(bytes: Uint8Array): Promise<SniffResult> {
  const compressed =
    bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!compressed) return sniffHead(bytes, false);

  const chunks: Uint8Array[] = [];
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= 65536) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // Truncated trailing member: keep whatever decompressed before the error.
  }
  if (chunks.length === 0) return { kind: null, compressed };
  const head = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    head.set(c, offset);
    offset += c.byteLength;
  }
  return sniffHead(head, compressed);
}
