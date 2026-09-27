import { describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { createZip64Archive, createZip64FileSpool, zip64EndRecords, zip64MemberHeaders, type Zip64Member, type Zip64Options, type Zip64Spool } from "./archive-zip64";

const modifiedAt = Date.UTC(2026, 8, 23, 12, 0, 2), receipt = "a".repeat(64);
function source(...chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } });
}
function member(name = "reports.json", text = "saved report"): Zip64Member {
  const bytes = Buffer.from(text); return { name, sizeBytes: bytes.length, open: async () => bytes.length ? source(bytes) : source() };
}
function spoolFixture() {
  const records: Uint8Array[] = [];
  const spool = { append: vi.fn(async (record: Uint8Array) => { records.push(Buffer.from(record)); }),
    replay: vi.fn(() => source(...records)), dispose: vi.fn(async () => {}) } satisfies Zip64Spool;
  return { spool, records };
}
function plan(items: Zip64Member[] = [member()], overrides: Partial<Zip64Options> = {}) {
  const { spool } = spoolFixture();
  return { members: (async function* () { yield* items; })(), expectedMemberCount: items.length,
    expectedPayloadBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0), modifiedAt, deadline: Date.now() + 60_000,
    signal: new AbortController().signal, authorityReceipt: receipt, checkAuthority: vi.fn(async () => receipt), spool, ...overrides };
}
async function collect(stream: ReadableStream<Uint8Array>, chunks: Uint8Array[] = []) {
  const reader = stream.getReader();
  try { for (;;) { const next = await reader.read(); if (next.done) return Buffer.concat(chunks); chunks.push(next.value); } }
  finally { reader.releaseLock(); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe("bounded ZIP64 producer", () => {
  it("round-trips saved UTF-8 report/correction bytes without rewriting and has deterministic headers", async () => {
    const content = JSON.stringify({ interpretation: "Saved ε4 wording", scientific_correction: { status: "known-superseded", notice: "Saved wording was corrected." } });
    const items = [member("reports.json", content), member("reports.txt", "Saved ε4 wording\nSaved wording was corrected.")];
    const a = await collect(createZip64Archive(plan(items))), b = await collect(createZip64Archive(plan(items)));
    expect(a).toEqual(b);
    const zip = new AdmZip(a);
    expect(zip.getEntries().map(e => e.entryName)).toEqual(["reports.json", "reports.txt"]);
    expect(zip.readAsText("reports.json")).toBe(content);
    expect(zip.readAsText("reports.txt")).toBe("Saved ε4 wording\nSaved wording was corrected.");
    expect(a.readUInt16LE(4)).toBe(45);
    expect(a.readUInt32LE(18)).toBe(0xffffffff);
    expect(a.readUInt32LE(a.length - 98)).toBe(0x06064b50);
    expect(a.readBigUInt64LE(a.length - 74)).toBe(BigInt(2));
  });
  it("supports a genuinely empty manifest and zero-byte members", async () => {
    for (const items of [[], [member("empty.txt", "")]]) {
      const bytes = await collect(createZip64Archive(plan(items)));
      expect(new AdmZip(bytes).getEntries()).toHaveLength(items.length);
    }
  });
  it("uses real ephemeral metadata storage and streams more than 512 members without a member-list cap", async () => {
    const spool = await createZip64FileSpool();
    const options = plan([], { spool, expectedMemberCount: 513, members: (async function* () {
      for (let index = 0; index < 513; index++) yield member(`records/${String(index).padStart(4, "0")}.json`, "");
    })() });
    const bytes = await collect(createZip64Archive(options));
    expect(new AdmZip(bytes).getEntries()).toHaveLength(513);
    await expect(spool.append(new Uint8Array(74), new AbortController().signal)).rejects.toMatchObject({ code: "spool" });
    await spool.dispose();
  });
  it("validates >4 GiB sizes/offsets in the same header encoders without claiming a large transfer", () => {
    const size = 2 ** 32 + 9, offset = 2 ** 33 + 17, name = "originals/source.bin";
    const { local, descriptor, central } = zip64MemberHeaders(name, size, offset, 0xcbf43926, modifiedAt);
    expect(local.readUInt16LE(4)).toBe(45);
    expect(local.readBigUInt64LE(34 + name.length)).toBe(BigInt(size));
    expect(descriptor.readBigUInt64LE(8)).toBe(BigInt(size));
    expect(central.readBigUInt64LE(66 + name.length)).toBe(BigInt(offset));
    const end = zip64EndRecords(65_536, central.length, offset);
    expect(end.readBigUInt64LE(24)).toBe(BigInt(65_536));
    expect(end.readBigUInt64LE(48)).toBe(BigInt(offset));
    expect(end.readBigUInt64LE(64)).toBe(BigInt(offset + central.length));
    expect(() => zip64EndRecords(1, 10, Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it("computes the standard CRC32 vector over separate chunks", async () => {
    const value = { name: "crc.txt", sizeBytes: 9, open: async () => source(Buffer.from("1234"), Buffer.from("56789")) };
    const bytes = await collect(createZip64Archive(plan([value])));
    const zip = new AdmZip(bytes); expect(zip.readAsText("crc.txt")).toBe("123456789");
    expect(zip.getEntry("crc.txt")!.header.crc).toBe(0xcbf43926);
  });
  it.each(["../a", "a/../b", "/a", "a//b", "a/", "a\\b", "C:a", "con", "aux.txt", "a/lpt1.csv", "a.", "A.txt", "a%2fb", "é.txt", "a\0b", "a".repeat(256)])("refuses unsafe or ambiguous generated path %s", async name => {
    const open = vi.fn(async () => source());
    await expect(collect(createZip64Archive(plan([{ name, sizeBytes: 0, open }])))).rejects.toMatchObject({ code: "input" });
    expect(open).not.toHaveBeenCalled();
  });
  it.each([{ names: ["a", "a"] }, { names: ["b", "a"] }, { names: ["a", "a/b"] },
    { names: ["a", "a-b", "a/b"] }])("rejects duplicate, file/directory collision or noncanonical order $names", async ({ names }) => {
    await expect(collect(createZip64Archive(plan(names.map(n => member(n)))))).rejects.toMatchObject({ code: "order" });
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("refuses invalid manifest accounting %s", async value => {
    await expect(collect(createZip64Archive(plan([], { expectedMemberCount: value })))).rejects.toMatchObject({ code: "input" });
    await expect(collect(createZip64Archive(plan([], { expectedPayloadBytes: value })))).rejects.toMatchObject({ code: "input" });
  });
  it.each([Date.UTC(1979, 11, 31), Date.UTC(2108, 0, 1), NaN])("rejects a timestamp outside DOS range %s", async modifiedAt => {
    await expect(collect(createZip64Archive(plan([], { modifiedAt })))).rejects.toMatchObject({ code: "input" });
  });
  it.each([0, 2])("rejects exact manifest count mismatch %s", async expectedMemberCount => {
    await expect(collect(createZip64Archive(plan([member()], { expectedMemberCount })))).rejects.toMatchObject({ code: "count" });
  });
  it.each([1, 20])("rejects manifest total-size mismatch %s", async expectedPayloadBytes => {
    await expect(collect(createZip64Archive(plan([member()], { expectedPayloadBytes })))).rejects.toMatchObject({ code: "size" });
  });
  it.each([2, 4])("rejects short/excess member streams with expected size %s", async sizeBytes => {
    await expect(collect(createZip64Archive(plan([{ name: "a", sizeBytes, open: async () => source(Buffer.from("abc")) }])))).rejects.toMatchObject({ code: "size" });
  });
  it("enforces the decimal chunk cap and accepts exactly 4,000,000 bytes", async () => {
    for (const count of [4_000_000, 4_000_001]) {
      const value = { name: "a", sizeBytes: count, open: async () => source(new Uint8Array(count)) };
      const result = collect(createZip64Archive(plan([value])));
      if (count === 4_000_000) expect(new AdmZip(await result).getEntry("a")!.header.size).toBe(count);
      else await expect(result).rejects.toMatchObject({ code: "source" });
    }
  });
  it("does not select or read ahead without downstream demand", async () => {
    let selections = 0, reads = 0;
    const options = plan([], { expectedMemberCount: 1, expectedPayloadBytes: 2, members: (async function* () {
      selections++; yield { name: "a", sizeBytes: 2, open: async () => new ReadableStream<Uint8Array>({ pull(c) {
        reads++; if (reads <= 2) c.enqueue(Buffer.from("a")); else c.close();
      } }, { highWaterMark: 0 }) };
    })() });
    const stream = createZip64Archive(options); await Promise.resolve(); expect(selections).toBe(0);
    const reader = stream.getReader(); await reader.read(); expect(selections).toBe(1); expect(reads).toBe(0);
    await reader.read(); expect(reads).toBe(1); await Promise.resolve(); expect(reads).toBe(1);
    await reader.cancel(); expect(options.spool.dispose).toHaveBeenCalledTimes(1);
  });
  it("refuses changed authority after a source await before releasing its bytes", async () => {
    const pending = deferred<ReadableStreamReadResult<Uint8Array>>(), started = deferred<void>();
    let current = receipt;
    const item = { name: "a", sizeBytes: 1, open: async () => new ReadableStream<Uint8Array>({ async pull(c) {
      started.resolve(); const result = await pending.promise; c.enqueue(result.value!);
    } }, { highWaterMark: 0 }) };
    const reader = createZip64Archive(plan([item], { checkAuthority: async () => current })).getReader(); await reader.read();
    const read = reader.read(); await started.promise; current = "b".repeat(64); pending.resolve({ done: false, value: Buffer.from("a") });
    await expect(read).rejects.toMatchObject({ code: "authority" });
  });
  it("rejects before opening anything on initial authority failure", async () => {
    const open = vi.fn(async () => source()), options = plan([{ name: "a", sizeBytes: 0, open }], { checkAuthority: async () => "b".repeat(64) });
    await expect(collect(createZip64Archive(options))).rejects.toMatchObject({ code: "authority" });
    expect(open).not.toHaveBeenCalled(); expect(options.spool.dispose).toHaveBeenCalledTimes(1);
  });
  it("refuses a changed receipt after descriptor selection before invoking the member", async () => {
    const selected = deferred<IteratorResult<Zip64Member>>(), started = deferred<void>(), open = vi.fn(async () => source());
    let current = receipt;
    const members = { [Symbol.asyncIterator]: () => ({ next: async () => { started.resolve(); return selected.promise; } }) };
    const result = collect(createZip64Archive(plan([], { members, expectedMemberCount: 1, checkAuthority: async () => current })));
    await started.promise; current = "b".repeat(64); selected.resolve({ done: false, value: { name: "a", sizeBytes: 0, open } });
    await expect(result).rejects.toMatchObject({ code: "authority" }); expect(open).not.toHaveBeenCalled();
  });
  it.each(["open", "append", "replay", "dispose"] as const)("rechecks exact authority after %s", async phase => {
    let current = receipt; const { spool, records } = spoolFixture(); const item = { ...member("a", "saved") };
    if (phase === "open") item.open = async () => { current = "b".repeat(64); return source(Buffer.from("saved")); };
    if (phase === "append") spool.append.mockImplementation(async value => { records.push(Buffer.from(value)); current = "b".repeat(64); });
    if (phase === "replay") spool.replay.mockImplementation(() => { current = "b".repeat(64); return source(...records); });
    if (phase === "dispose") spool.dispose.mockImplementation(async () => { current = "b".repeat(64); });
    const chunks: Uint8Array[] = [];
    await expect(collect(createZip64Archive(plan([item], { spool, checkAuthority: async () => current })), chunks)).rejects.toMatchObject({ code: "authority" });
    expect(Buffer.concat(chunks).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
  });
  it("refuses malformed descriptors and zero-length chunks rather than spinning", async () => {
    const bad = { ...member(), extra: true };
    await expect(collect(createZip64Archive(plan([bad])))).rejects.toMatchObject({ code: "input" });
    await expect(collect(createZip64Archive(plan([{ name: "a", sizeBytes: 0, open: async () => source(new Uint8Array()) }])))).rejects.toMatchObject({ code: "source" });
  });
  it("copies source chunks before release so later producer mutation cannot alter released bytes", async () => {
    const value = Buffer.from("saved"), item = { name: "a", sizeBytes: 5, open: async () => source(value) };
    const reader = createZip64Archive(plan([item])).getReader(); await reader.read(); const next = await reader.read();
    value.fill(0); expect(Buffer.from(next.value!).toString()).toBe("saved"); await reader.cancel();
  });
  it("snapshots descriptor identity and callback before the post-selection authority await", async () => {
    const item = { ...member("a", "saved") }, wrongOpen = vi.fn(async () => source()); let selected = false;
    const members = (async function* () { selected = true; yield item; })();
    const checkAuthority = async () => { if (selected) { item.name = "wrong"; item.sizeBytes = 99; item.open = wrongOpen; } return receipt; };
    const bytes = await collect(createZip64Archive(plan([], { members, expectedMemberCount: 1, expectedPayloadBytes: 5, checkAuthority })));
    expect(new AdmZip(bytes).readAsText("a")).toBe("saved"); expect(wrongOpen).not.toHaveBeenCalled();
  });
  it("copies source and directory chunks before post-read authority awaits", async () => {
    const payload = Buffer.from("saved"), { spool, records } = spoolFixture(); let sourceRead = false, directoryRead = false; let directory: Buffer;
    const item = { name: "a", sizeBytes: 5, open: async () => new ReadableStream<Uint8Array>({ pull(c) { sourceRead = true; c.enqueue(payload); c.close(); } }, { highWaterMark: 0 }) };
    spool.replay.mockImplementation(() => { directory = Buffer.concat(records); return new ReadableStream({ pull(c) { directoryRead = true; c.enqueue(directory); c.close(); } }, { highWaterMark: 0 }); });
    const checkAuthority = async () => { if (sourceRead) payload.fill(0); if (directoryRead) directory.fill(0); return receipt; };
    const bytes = await collect(createZip64Archive(plan([item], { spool, checkAuthority })));
    expect(new AdmZip(bytes).readAsText("a")).toBe("saved");
  });
  it("disposes an already-created file spool on invalid construction before rejecting consumption", async () => {
    const spool = await createZip64FileSpool();
    await expect(collect(createZip64Archive(plan([], { spool, modifiedAt: NaN })))).rejects.toMatchObject({ code: "input" });
    await expect(spool.append(new Uint8Array(74), new AbortController().signal)).rejects.toMatchObject({ code: "spool" });
    const failing = spoolFixture().spool; failing.dispose.mockRejectedValue(new Error("cleanup failed"));
    await expect(collect(createZip64Archive(plan([], { spool: failing, expectedMemberCount: -1 })))).rejects.toMatchObject({ code: "cleanup" });
  });
  it("cancels before the first pull and still disposes the spool", async () => {
    const options = plan(); await createZip64Archive(options).cancel(); expect(options.checkAuthority).not.toHaveBeenCalled(); expect(options.spool.dispose).toHaveBeenCalledTimes(1);
  });
  it("external abort interrupts a stalled read even when source cancellation never settles", async () => {
    const abort = new AbortController(), started = deferred<void>(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const options = plan([{ name: "a", sizeBytes: 1, open: async () => new ReadableStream<Uint8Array>({ pull() { started.resolve(); return new Promise(() => {}); }, cancel }, { highWaterMark: 0 }) }], { signal: abort.signal });
    const reader = createZip64Archive(options).getReader(); await reader.read(); const next = reader.read(); await started.promise; abort.abort();
    await expect(next).rejects.toMatchObject({ code: "aborted" }); expect(cancel).toHaveBeenCalled();
  });
  it("cancels a source which arrives after an aborted open", async () => {
    const abort = new AbortController(), pending = deferred<ReadableStream<Uint8Array>>(), started = deferred<void>(), cancel = vi.fn();
    const options = plan([{ name: "a", sizeBytes: 0, open: async () => { started.resolve(); return pending.promise; } }], { signal: abort.signal });
    const read = collect(createZip64Archive(options)); await started.promise; abort.abort();
    await expect(read).rejects.toMatchObject({ code: "aborted" }); pending.resolve(new ReadableStream({ cancel }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
  it.each(["short", "changed", "excess"])("refuses %s central spool replay without a valid ZIP EOF", async corruption => {
    const { spool, records } = spoolFixture();
    spool.replay.mockImplementation(() => { const b = Buffer.concat(records); if (corruption === "short") return source(b.subarray(1)); if (corruption === "changed") b[0] ^= 1; return source(b, ...(corruption === "excess" ? [Buffer.from("x")] : [])); });
    const chunks: Uint8Array[] = [];
    await expect(collect(createZip64Archive(plan([member()], { spool })), chunks)).rejects.toMatchObject({ code: "spool" });
    expect(Buffer.concat(chunks).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
  });
  it("propagates disk/append and cleanup failures, with no successful end record", async () => {
    for (const where of ["append", "dispose"] as const) {
      const { spool } = spoolFixture(); spool[where].mockRejectedValue(new Error("private filesystem detail")); const chunks: Uint8Array[] = [];
      await expect(collect(createZip64Archive(plan([member()], { spool })), chunks)).rejects.toMatchObject({ code: where === "append" ? "spool" : "cleanup" });
      expect(Buffer.concat(chunks).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(false);
    }
  });
  it("bounds uncooperative cleanup before EOF", async () => {
    vi.useFakeTimers();
    try {
      const started = deferred<void>(), { spool } = spoolFixture(); spool.dispose.mockImplementation(() => { started.resolve(); return new Promise(() => {}); });
      const result = collect(createZip64Archive(plan([], { spool }))); const refusal = expect(result).rejects.toMatchObject({ code: "cleanup" });
      await started.promise; await vi.advanceTimersByTimeAsync(30_000); await refusal;
    } finally { vi.useRealTimers(); }
  });
  it("bounds a stalled source operation by the fixed whole-job deadline", async () => {
    vi.useFakeTimers();
    try {
      const started = deferred<void>(); const options = plan([], { deadline: Date.now() + 50, checkAuthority: async () => { started.resolve(); return new Promise(() => {}); } });
      const result = collect(createZip64Archive(options)); const refusal = expect(result).rejects.toMatchObject({ code: "deadline" });
      await started.promise; await vi.advanceTimersByTimeAsync(51); await refusal; expect(options.spool.dispose).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("snapshots manifest values and callbacks across awaits", async () => {
    const options = plan([member("a", "hello")]); const stream = createZip64Archive(options), reader = stream.getReader();
    const header = await reader.read(); options.expectedPayloadBytes = 9; options.checkAuthority = vi.fn(async () => "b".repeat(64));
    const chunks = [header.value!]; for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
    expect(new AdmZip(Buffer.concat(chunks)).readAsText("a")).toBe("hello"); expect(options.checkAuthority).not.toHaveBeenCalled();
  });
});
