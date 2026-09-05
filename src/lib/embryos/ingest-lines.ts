import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS } from "../genome/ingest-limits";

/** Coded failures only: a parser error must never carry source text. */
export class EmbryoTransportError extends Error {
  constructor(public readonly code: "unrecognised_format" | "pdf_not_data" | "too_large" | "empty_after_parse" | "build_unknown" | "invalid_session" | "invalid_chunk") {
    super(code);
    this.name = "EmbryoTransportError";
  }
}

/**
 * Fatal UTF-8 decoding after byte-level line framing. Memory is bounded by
 * one logical line, even when a producer delivers a huge buffer. Limits
 * count all decoded input, including metadata and discarded contigs.
 */
export async function* embryoInputLines(source: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = source.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const line = new Uint8Array(LIMITS.maximumLogicalLineBytes);
  let length = 0;
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        break;
      }
      total += next.value.byteLength;
      if (total > LIMITS.maximumUncompressedInputBytes) throw new EmbryoTransportError("too_large");
      let start = 0;
      while (start < next.value.length) {
        const newline = next.value.indexOf(10, start);
        const end = newline < 0 ? next.value.length : newline;
        const count = end - start;
        if (length + count > line.length) throw new EmbryoTransportError("too_large");
        line.set(next.value.subarray(start, end), length);
        length += count;
        if (newline < 0) break;
        const contentLength = length > 0 && line[length - 1] === 13 ? length - 1 : length;
        const text = decoder.decode(line.subarray(0, contentLength));
        line.fill(0, 0, length);
        length = 0;
        if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) throw new EmbryoTransportError("unrecognised_format");
        yield text;
        start = newline + 1;
      }
    }
    // A source may omit its final newline; transport chunks never do.
    if (length > 0) {
      const text = decoder.decode(line.subarray(0, length));
      if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) throw new EmbryoTransportError("unrecognised_format");
      yield text;
    }
  } catch (error) {
    if (error instanceof EmbryoTransportError) throw error;
    // Includes malformed UTF-8, truncated gzip and input-stream errors.
    throw new EmbryoTransportError("unrecognised_format");
  } finally {
    line.fill(0);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Browser decompression; no raw input reaches a network or disk sink here. */
export async function embryoFileStream(file: Blob): Promise<ReadableStream<Uint8Array>> {
  const magic = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(magic) === "%PDF-") throw new EmbryoTransportError("pdf_not_data");
  const stream = file.stream();
  return magic[0] === 0x1f && magic[1] === 0x8b
    ? stream.pipeThrough(new DecompressionStream("gzip"))
    : stream;
}
