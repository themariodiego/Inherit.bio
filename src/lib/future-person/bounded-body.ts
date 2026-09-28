/**
 * Read a request body up to a byte limit, and no further. A body over the
 * limit is cancelled as soon as it crosses it, so no route holds more than
 * its own limit in memory.
 */
export type BoundedBody = { kind: "bytes"; bytes: Uint8Array } | { kind: "too_large" } | { kind: "unreadable" };

export async function readBoundedBytes(request: Request, limit: number): Promise<BoundedBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > limit) {
    await request.body?.cancel().catch(() => undefined);
    return { kind: "too_large" };
  }
  if (!request.body) return { kind: "bytes", bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        for (const part of chunks) part.fill(0);
        return { kind: "too_large" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    for (const part of chunks) part.fill(0);
    return { kind: "unreadable" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
    part.fill(0);
  }
  return { kind: "bytes", bytes };
}

/** Well-formed UTF-8 JSON of at most `limit` bytes, or undefined. */
export async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  const body = await readBoundedBytes(request, limit);
  if (body.kind !== "bytes") return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return undefined;
  }
}
