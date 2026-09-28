import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EmbryoFragmentStorageError, type EmbryoStoredFragment } from "./fragment-storage";
import { r2EmbryoFragmentReader } from "./split-fragment-reader";
import { EmbryoSplitFragmentMismatch, type EmbryoFragmentRef } from "./split-worker";

function stored(): EmbryoStoredFragment {
  return { receipt: { version: "embryo-ingest-write-target-v1", sessionId: randomUUID(), sequence: 1, ordinal: 2,
    backend: "r2", bucket: "inherit-embryo-synthetic", objectKey: `embryo/${randomUUID()}`, byteCount: 120,
    sha256: "a".repeat(64), writeExpiresAt: new Date(Date.now() + 60_000).toISOString() },
    providerVersion: "1".repeat(32), etag: "2".repeat(32) };
}
function refFor(value: EmbryoStoredFragment, landed: unknown = { backend: "r2", stored: value }): EmbryoFragmentRef {
  const { sessionId, sequence, ordinal, byteCount, sha256 } = value.receipt;
  return { sessionId, sequence, ordinal, byteCount, sha256, landed };
}
const signal = new AbortController().signal;

describe("R2 fragment reader for the split worker", () => {
  it("reads exactly the landed version SQL issued", async () => {
    const value = stored();
    const bytes = new Uint8Array([1, 2, 3]);
    const read = vi.fn(async () => bytes);
    await expect(r2EmbryoFragmentReader(read)(refFor(value), signal)).resolves.toBe(bytes);
    expect(read).toHaveBeenCalledWith({ stored: value, signal });
  });

  it.each([
    ["another session", (r: EmbryoFragmentRef) => ({ ...r, sessionId: randomUUID() })],
    ["another chunk", (r: EmbryoFragmentRef) => ({ ...r, sequence: r.sequence + 1 })],
    ["another embryo", (r: EmbryoFragmentRef) => ({ ...r, ordinal: r.ordinal + 1 })],
    ["another size", (r: EmbryoFragmentRef) => ({ ...r, byteCount: r.byteCount + 1 })],
    ["another digest", (r: EmbryoFragmentRef) => ({ ...r, sha256: "b".repeat(64) })],
  ])("refuses a landed identity for %s without reading", async (_, change) => {
    const read = vi.fn();
    await expect(r2EmbryoFragmentReader(read)(change(refFor(stored())), signal))
      .rejects.toBeInstanceOf(EmbryoSplitFragmentMismatch);
    expect(read).not.toHaveBeenCalled();
  });

  it("has no reader for a Supabase landing or a malformed identity", async () => {
    const read = vi.fn();
    const value = stored();
    for (const landed of [{ backend: "supabase" }, { backend: "r2", stored: { ...value, etag: "short" } }, null, "r2"]) {
      await expect(r2EmbryoFragmentReader(read)(refFor(value, landed), signal))
        .rejects.toBeInstanceOf(EmbryoSplitFragmentMismatch);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("treats a missing, fenced or different version as terminal and transport trouble as retryable", async () => {
    for (const code of ["integrity_mismatch", "conflict", "invalid_request"] as const) {
      const read = vi.fn(async () => { throw new EmbryoFragmentStorageError(code); });
      await expect(r2EmbryoFragmentReader(read)(refFor(stored()), signal)).rejects.toBeInstanceOf(EmbryoSplitFragmentMismatch);
    }
    for (const code of ["unavailable", "aborted"] as const) {
      const read = vi.fn(async () => { throw new EmbryoFragmentStorageError(code); });
      await expect(r2EmbryoFragmentReader(read)(refFor(stored()), signal)).rejects.toMatchObject({ code });
    }
  });
});
