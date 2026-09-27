import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_OPERATION_TIMEOUT_MS, ARCHIVE_SEGMENT_BYTES, type ArchiveAttempt,
  type StoredArchiveSegment } from "./archive-segments";
import { readArchiveSegment, type ArchiveSegmentObject, type ArchiveSegmentReadOptions } from "./archive-segment-reader";

const receipt = "e".repeat(64);
const payload = new TextEncoder().encode("synthetic export bytes");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const attempt: ArchiveAttempt = Object.freeze({ version: "archive-segments-v1", bucket: "exports",
  principalHash: "a".repeat(64), exportId: "10000000-0000-4000-8000-000000000001",
  attemptId: "20000000-0000-4000-8000-000000000002" });
function segment(bytes = payload, ordinal = 0): StoredArchiveSegment {
  return { ordinal, offset: ordinal * ARCHIVE_SEGMENT_BYTES, sizeBytes: bytes.length, sha256: digest(bytes),
    objectKey: `${attempt.principalHash}/${attempt.exportId}/${attempt.attemptId}-${ordinal}.part`,
    objectId: "30000000-0000-4000-8000-000000000003" };
}
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const bytes of chunks) controller.enqueue(bytes);
    controller.close();
  } });
}
function fixture() {
  const selected = segment(), controller = new AbortController();
  const checkAuthority = vi.fn<ArchiveSegmentReadOptions["checkAuthority"]>().mockResolvedValue(receipt);
  const object: ArchiveSegmentObject = { objectId: selected.objectId, objectKey: selected.objectKey,
    sizeBytes: selected.sizeBytes, body: stream([payload]) };
  const readObject = vi.fn<ArchiveSegmentReadOptions["readObject"]>().mockResolvedValue(object);
  const options = { attempt: { ...attempt }, segment: selected, authorityReceipt: receipt,
    deadline: Date.now() + 60_000, signal: controller.signal, checkAuthority, readObject };
  return { options, selected, controller, checkAuthority, object, readObject };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function reached(condition: () => boolean) {
  for (let n = 0; n < 50 && !condition(); n++) await Promise.resolve();
  expect(condition()).toBe(true);
}
afterEach(() => { vi.useRealTimers(); });

describe("bounded physical export segment reader", () => {
  it("requires pinned current authority around the read and returns only an owned verified buffer", async () => {
    const f = fixture(), events: string[] = [], original = Uint8Array.from(payload);
    f.checkAuthority.mockImplementation(async (_attempt, _segment, expected) => {
      events.push("authority"); expect(expected).toBe(receipt); return receipt;
    });
    f.readObject.mockImplementation(async (givenAttempt, givenSegment, signal) => {
      events.push("read"); expect(Object.isFrozen(givenAttempt)).toBe(true); expect(Object.isFrozen(givenSegment)).toBe(true);
      expect(givenAttempt).toEqual(attempt); expect(givenSegment).toEqual(f.selected); expect(signal.aborted).toBe(false);
      return { ...f.object, body: stream([original.subarray(0, 3), original.subarray(3)]) };
    });
    const result = await readArchiveSegment(f.options);
    expect(events).toEqual(["authority", "read", "authority", "authority"]);
    expect(result).toEqual(payload); expect(result.buffer).not.toBe(original.buffer);
    original.fill(0); expect(result).toEqual(payload); expect(f.readObject).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 4,000,000 physical bytes and cleans up its caller abort listener", async () => {
    const f = fixture(), exact = new Uint8Array(ARCHIVE_SEGMENT_BYTES).fill(17), selected = segment(exact);
    const added = vi.spyOn(f.options.signal, "addEventListener"), removed = vi.spyOn(f.options.signal, "removeEventListener");
    f.options.segment = selected;
    f.readObject.mockResolvedValue({ objectId: selected.objectId, objectKey: selected.objectKey,
      sizeBytes: selected.sizeBytes, body: stream([exact]) });
    const result = await readArchiveSegment(f.options);
    expect(result.byteLength).toBe(4_000_000); expect(digest(result)).toBe(selected.sha256);
    expect(result.buffer).not.toBe(exact.buffer);
    expect(added).toHaveBeenCalledTimes(1); expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
  });

  it("handles a bounded segment beyond the 4 GiB offset without allocating the logical archive", async () => {
    const f = fixture(), selected = segment(payload, 1074);
    expect(selected.offset).toBe(4_296_000_000);
    f.options.segment = selected;
    f.readObject.mockResolvedValue({ ...f.object, objectKey: selected.objectKey });
    expect(await readArchiveSegment(f.options)).toEqual(payload);
  });

  it.each([
    ["foreign bucket", { attempt: { ...attempt, bucket: "other" } }],
    ["wrong version", { attempt: { ...attempt, version: "other" } }],
    ["invalid attempt", { attempt: { ...attempt, attemptId: "../elsewhere" } }],
    ["extra attempt field", { attempt: { ...attempt, url: "https://example.invalid" } }],
    ["empty length", { segment: { ...segment(), sizeBytes: 0 } }],
    ["oversized physical segment", { segment: { ...segment(), sizeBytes: ARCHIVE_SEGMENT_BYTES + 1 } }],
    ["wrong offset", { segment: { ...segment(), offset: 1 } }],
    ["unsafe ordinal", { segment: { ...segment(), ordinal: Number.MAX_SAFE_INTEGER } }],
    ["negative ordinal", { segment: { ...segment(), ordinal: -1 } }],
    ["bad digest", { segment: { ...segment(), sha256: "bad" } }],
    ["unbound key", { segment: { ...segment(), objectKey: `${attempt.principalHash}/other.part` } }],
    ["different attempt key", { segment: { ...segment(), objectKey: `${attempt.principalHash}/${attempt.exportId}/40000000-0000-4000-8000-000000000004-0.part` } }],
    ["bad object identity", { segment: { ...segment(), objectId: "not-an-object" } }],
    ["client range", { segment: { ...segment(), range: "bytes=0-4" } }],
    ["signed URL", { url: "https://example.invalid/signed" }],
    ["bad receipt", { authorityReceipt: "not-a-receipt" }],
  ])("refuses %s before authority or storage", async (_name, change) => {
    const f = fixture();
    await expect(readArchiveSegment({ ...f.options, ...change } as unknown as ArchiveSegmentReadOptions))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(f.checkAuthority).not.toHaveBeenCalled(); expect(f.readObject).not.toHaveBeenCalled();
  });

  it("refuses accessors and symbolic metadata without invoking accessors", async () => {
    const f = fixture(), getter = vi.fn(() => f.selected.sha256);
    const selected = { ...f.selected };
    Object.defineProperty(selected, "sha256", { enumerable: true, get: getter });
    await expect(readArchiveSegment({ ...f.options, segment: selected })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(readArchiveSegment({ ...f.options, segment: { ...f.selected, [Symbol("hidden")]: "extra" } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(getter).not.toHaveBeenCalled(); expect(f.readObject).not.toHaveBeenCalled();
  });

  it.each(["revoked", "new-receipt", "missing-receipt"])("refuses initial %s authority without a provider read", async kind => {
    const f = fixture();
    if (kind === "revoked") f.checkAuthority.mockRejectedValue(new Error("EXAMPLE_ONLY_PRIVATE_DETAIL"));
    else f.checkAuthority.mockResolvedValue(kind === "new-receipt" ? "f".repeat(64) : "");
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "authority", message: "authority" });
    expect(f.readObject).not.toHaveBeenCalled();
  });

  it.each([2, 3])("refuses changed authority at checkpoint %i and releases no bytes", async checkpoint => {
    const f = fixture(); let calls = 0, released = false;
    f.checkAuthority.mockImplementation(async () => ++calls === checkpoint ? "f".repeat(64) : receipt);
    const result = readArchiveSegment(f.options).then(bytes => { released = true; return bytes; });
    await expect(result).rejects.toMatchObject({ code: "authority" });
    expect(released).toBe(false); expect(f.readObject).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["object ID", { objectId: "40000000-0000-4000-8000-000000000004" }],
    ["key", { objectKey: "other/key" }],
    ["length", { sizeBytes: payload.length + 1 }],
    ["redirect result", { redirected: true }],
    ["partial response", { contentRange: "bytes 0-4/99" }],
  ])("refuses provider %s drift and cancels its body", async (_name, change) => {
    const f = fixture(), cancel = vi.fn();
    f.readObject.mockResolvedValue({ ...f.object, body: new ReadableStream({ cancel }), ...change });
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["short", [payload.subarray(1)]],
    ["excess", [payload, Uint8Array.of(1)]],
    ["empty chunk", [new Uint8Array(0)]],
    ["checksum", [new Uint8Array(payload.length)]],
  ])("refuses %s payload before returning bytes", async (_name, chunks) => {
    const f = fixture(); f.readObject.mockResolvedValue({ ...f.object, body: stream(chunks) });
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "integrity" });
  });

  it("redacts provider and stream errors", async () => {
    const f = fixture(); f.readObject.mockRejectedValue(new Error("EXAMPLE_ONLY_PRIVATE_DETAIL"));
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "storage", message: "storage" });
    const next = fixture(); next.readObject.mockResolvedValue({ ...next.object,
      body: new ReadableStream({ start(controller) { controller.error(new Error("EXAMPLE_ONLY_PRIVATE_DETAIL")); } }) });
    await expect(readArchiveSegment(next.options)).rejects.toMatchObject({ code: "storage", message: "storage" });
  });

  it("freezes selected identity before awaiting authority so caller mutation cannot redirect the read", async () => {
    const f = fixture(), entered = deferred<string>();
    f.checkAuthority.mockImplementationOnce(() => entered.promise);
    const pending = readArchiveSegment(f.options);
    await reached(() => f.checkAuthority.mock.calls.length === 1);
    f.options.attempt.exportId = "40000000-0000-4000-8000-000000000004";
    f.options.segment = { ...f.selected, objectKey: "other/path" };
    entered.resolve(receipt);
    expect(await pending).toEqual(payload);
    expect(f.readObject.mock.calls[0][0].exportId).toBe(attempt.exportId);
    expect(f.readObject.mock.calls[0][1].objectKey).toBe(f.selected.objectKey);
  });

  it("rejects pre-aborted input and expired deadlines before work", async () => {
    const f = fixture(); f.controller.abort();
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "aborted" });
    const g = fixture(); g.options.deadline = Date.now();
    await expect(readArchiveSegment(g.options)).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.checkAuthority).not.toHaveBeenCalled(); expect(g.readObject).not.toHaveBeenCalled();
  });

  it("aborts while storage is awaiting and cancels a late body without adopting it", async () => {
    const f = fixture(), later = deferred<ArchiveSegmentObject>(), cancel = vi.fn();
    f.readObject.mockImplementation(() => later.promise);
    const pending = readArchiveSegment(f.options);
    await reached(() => f.readObject.mock.calls.length === 1);
    const signal = f.readObject.mock.calls[0][2]; f.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(signal.aborted).toBe(true);
    later.resolve({ ...f.object, body: new ReadableStream({ cancel }) });
    await reached(() => cancel.mock.calls.length === 1);
    expect(f.checkAuthority).toHaveBeenCalledTimes(1);
  });

  it("aborts a partial body read without waiting for the provider's stuck cancellation", async () => {
    const f = fixture(), never = new Promise<never>(() => {}), cancel = vi.fn(() => never), pull = vi.fn(() => never);
    f.readObject.mockResolvedValue({ ...f.object, body: new ReadableStream({
      start(controller) { controller.enqueue(payload.subarray(0, 2)); }, pull, cancel,
    }) });
    const outcome = readArchiveSegment(f.options).then(() => "released", error => error.code);
    await reached(() => f.checkAuthority.mock.calls.length === 2 && pull.mock.calls.length > 0);
    f.controller.abort();
    expect(await outcome).toBe("aborted"); expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.checkAuthority).toHaveBeenCalledTimes(2);
  });

  it.each(["authority", "provider", "body", "final-authority"])("bounds a stalled %s operation, even with a stuck cancel hook", async phase => {
    vi.useFakeTimers(); const f = fixture(), never = new Promise<never>(() => {}), cancel = vi.fn(() => never);
    if (phase === "authority") f.checkAuthority.mockImplementation(() => never);
    if (phase === "provider") f.readObject.mockImplementation(() => never);
    if (phase === "body") f.readObject.mockResolvedValue({ ...f.object, body: new ReadableStream({ cancel }) });
    if (phase === "final-authority") f.checkAuthority.mockResolvedValueOnce(receipt).mockResolvedValueOnce(receipt).mockImplementation(() => never);
    const outcome = readArchiveSegment(f.options).then(() => "released", error => error.code);
    await vi.advanceTimersByTimeAsync(ARCHIVE_OPERATION_TIMEOUT_MS);
    expect(await outcome).toBe("deadline");
    if (phase === "body") expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an earlier server deadline and bounds cancel while a read is awaiting", async () => {
    vi.useFakeTimers(); const f = fixture(), cancel = vi.fn(() => new Promise<never>(() => {}));
    f.options.deadline = Date.now() + 7;
    f.readObject.mockResolvedValue({ ...f.object, body: new ReadableStream({ cancel }) });
    const outcome = readArchiveSegment(f.options).then(() => "released", error => error.code);
    await vi.advanceTimersByTimeAsync(7);
    expect(await outcome).toBe("deadline"); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects same-turn abort while final authority resolves", async () => {
    const f = fixture(); let calls = 0;
    f.checkAuthority.mockImplementation(async () => { if (++calls === 3) f.controller.abort(); return receipt; });
    await expect(readArchiveSegment(f.options)).rejects.toMatchObject({ code: "aborted" });
  });
});
