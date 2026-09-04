// Browser-side format sniffing for the uploader: decompresses a gzip head
// with DecompressionStream (tolerating truncation — we only hold the first
// ~256 KB of the file) and delegates to the shared pure detector.
//
// This is the browser preflight of every genetic-file flow (register
// `genetic-file-ingest-v1.browserPreflight`; brief line 2194): it inspects
// the magic bytes before the first chunk of any transport is sent, and a
// `%PDF-` answer blocks the upload with the exact `pdf_not_data` sentence.

import { narrow, sniffHeadV2, type SniffResult, type SniffV2Result } from "./sniff";

export async function sniffFileV2(bytes: Uint8Array): Promise<SniffV2Result> {
  const compressed =
    bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!compressed) return sniffHeadV2(bytes, false);

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
  if (chunks.length === 0) return { kind: null, compressed, sampleCount: null, sampleNames: [] };
  const head = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    head.set(c, offset);
    offset += c.byteLength;
  }
  return sniffHeadV2(head, compressed);
}

/** The original signature: the V1 view of `sniffFileV2`. */
export async function sniffFile(bytes: Uint8Array): Promise<SniffResult> {
  return narrow(await sniffFileV2(bytes));
}
