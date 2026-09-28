import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { embryoFragmentStore, r2FragmentStore } from "./fragment-store";
import { EmbryoFragmentStorageError } from "./fragment-storage";

/** The chunk route's seam onto the R2 fragment backend (docs/embryo-fragment-storage.md). */
const SESSION = "a0000000-0000-4000-8000-000000000001";
function receipt(ordinal: number) {
  return {
    version: "embryo-ingest-write-target-v1", sessionId: SESSION, sequence: 2, ordinal, backend: "r2",
    bucket: "inherit-embryo-test", objectKey: `embryo/${randomUUID()}`, byteCount: 10, sha256: "a".repeat(64),
    writeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  } as const;
}
function rpcAnswering(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    const promise = Promise.resolve(result);
    return Object.assign(promise, { abortSignal: () => promise });
  };
  return { rpc, calls };
}

describe("reading the write targets", () => {
  it("asks the targets door for exactly this session and chunk and keeps each exact receipt", async () => {
    const r0 = receipt(0), r1 = receipt(1);
    const { rpc, calls } = rpcAnswering({ data: { status: "reserved", targets: [
      { receipt: r0, state: "open", stored: null },
      { receipt: r1, state: "landed", stored: { providerVersion: "b".repeat(32), etag: "c".repeat(32) } },
    ] }, error: null });
    const answer = await r2FragmentStore(rpc).targets(SESSION, 2);
    expect(calls).toEqual([["embryo_ingest_write_targets_v1", { p_session_id: SESSION, p_sequence: 2 }]]);
    expect(answer).toEqual({ status: "reserved", targets: [
      { ordinal: 0, state: "open", receipt: r0 }, { ordinal: 1, state: "landed", receipt: r1 },
    ] });
  });

  it("passes on a refusal, and reads a published attempt as one it no longer serves", async () => {
    for (const status of ["denied", "failure_pending"] as const) {
      expect(await r2FragmentStore(rpcAnswering({ data: { status }, error: null }).rpc).targets(SESSION, 2)).toEqual({ status });
    }
    expect(await r2FragmentStore(rpcAnswering({ data: { status: "published" }, error: null }).rpc).targets(SESSION, 2))
      .toEqual({ status: "denied" });
  });

  it("throws on a database error or an answer outside the contract", async () => {
    for (const result of [
      { data: null, error: { code: "55P03" } },
      { data: { status: "reserved", targets: [{ receipt: receipt(0), state: "landed", stored: null }] }, error: null },
      { data: { status: "reserved", targets: [{ receipt: { ...receipt(0), accountId: SESSION }, state: "open", stored: null }] }, error: null },
    ]) {
      await expect(r2FragmentStore(rpcAnswering(result).rpc).targets(SESSION, 2)).rejects.toBeInstanceOf(EmbryoFragmentStorageError);
    }
  });
});

describe("landing a fragment", () => {
  const target = { ordinal: 0, state: "open" as const, receipt: receipt(0) };

  it("hands the writer the exact receipt, bytes and signal, and reports a landing", async () => {
    const write = vi.fn().mockResolvedValue({ receipt: target.receipt, providerVersion: "b".repeat(32), etag: "c".repeat(32) });
    const { rpc } = rpcAnswering({ data: null, error: null });
    const bytes = new Uint8Array(10);
    const signal = new AbortController().signal;
    expect(await r2FragmentStore(rpc, write).write(target, bytes, signal)).toBe("landed");
    expect(write).toHaveBeenCalledExactlyOnceWith({ rpc, target: target.receipt, bytes, signal });
  });

  it("reports a conflict as never landing, and every other failure as a retry", async () => {
    const { rpc } = rpcAnswering({ data: null, error: null });
    const outcome = (error: unknown) => r2FragmentStore(rpc, vi.fn().mockRejectedValue(error))
      .write(target, new Uint8Array(10), new AbortController().signal);
    expect(await outcome(new EmbryoFragmentStorageError("conflict"))).toBe("conflict");
    for (const code of ["unavailable", "integrity_mismatch", "aborted", "invalid_request"] as const) {
      expect(await outcome(new EmbryoFragmentStorageError(code))).toBe("retry");
    }
    expect(await outcome(new Error("PRIVATE"))).toBe("retry");
  });
});

describe("the configured store", () => {
  it("is absent until this deployment names the fragment gateway and bucket", () => {
    expect(embryoFragmentStore({})).toBeNull();
    expect(embryoFragmentStore({ INHERIT_EMBRYO_R2_ORIGIN: "https://embryo.fragments.test" })).toBeNull();
    expect(embryoFragmentStore({ INHERIT_EMBRYO_R2_BUCKET: "inherit-embryo-test" })).toBeNull();
  });
});
