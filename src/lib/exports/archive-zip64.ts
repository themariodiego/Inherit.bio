import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_OPERATION_TIMEOUT_MS, ARCHIVE_SEGMENT_BYTES } from "./archive-segments";

/** A byte producer only: the caller supplies the complete, authorized manifest
 * and its captured receipt. No route, source selection or ready state is here. */
export type Zip64Member = Readonly<{
  name: string;
  sizeBytes: number;
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
}>;
export type Zip64Spool = Readonly<{
  append: (record: Uint8Array, signal: AbortSignal) => Promise<void>;
  replay: (signal: AbortSignal) => ReadableStream<Uint8Array>;
  dispose: () => Promise<void>;
}>;
export type Zip64Options = Readonly<{
  members: AsyncIterable<Zip64Member>;
  expectedMemberCount: number;
  expectedPayloadBytes: number;
  /** Captured UTC milliseconds, 1980 through 2107. DOS rounds down to 2 seconds. */
  modifiedAt: number;
  deadline: number;
  signal: AbortSignal;
  authorityReceipt: string;
  checkAuthority: (signal: AbortSignal) => Promise<string>;
  spool: Zip64Spool;
}>;
type Failure = "input" | "source" | "size" | "count" | "order" | "authority" | "spool" | "cleanup" | "aborted" | "deadline";
export class Zip64Error extends Error {
  constructor(readonly code: Failure) { super(code); this.name = "Zip64Error"; }
}
const fail = (code: Failure): never => { throw new Zip64Error(code); };
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
function sum(a: number, b: number): number { const n = a + b; if (!safe(n)) fail("size"); return n; }
const hashPattern = /^[0-9a-f]{64}$/;
function record(value: unknown, keys: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  const own = Reflect.ownKeys(value);
  return (prototype === null || prototype === Object.prototype)
    && own.every(key => typeof key === "string") && own.sort().join(",") === keys
    && own.every(key => { const d = Object.getOwnPropertyDescriptor(value, key)!; return d.enumerable && "value" in d; });
}
function nameBytes(name: string): Buffer {
  if (typeof name !== "string" || !name.length || name.length > 255
    || name.split("/").some(part => !/^[a-z0-9][a-z0-9._-]*$/.test(part) || part.endsWith(".")
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(part))) fail("input");
  return Buffer.from(name, "ascii");
}
function dosDate(modifiedAt: number): number {
  const date = new Date(modifiedAt), year = date.getUTCFullYear();
  if (!Number.isSafeInteger(modifiedAt) || !Number.isFinite(date.getTime()) || year < 1980 || year > 2107) fail("input");
  return (((year - 1980) << 25) | ((date.getUTCMonth() + 1) << 21) | (date.getUTCDate() << 16)
    | (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)) >>> 0;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crcStep(crc: number, bytes: Uint8Array) { for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }

/** PKWARE APPNOTE 6.3.10 §§4.3.7–4.3.16, 4.5.3. These same encoders accept
 * virtual safe-integer offsets in tests; that proves fields, not a large I/O run. */
export function zip64MemberHeaders(name: string, sizeBytes: number, offset: number, crc32: number, modifiedAt: number) {
  const bytes = nameBytes(name), time = dosDate(modifiedAt);
  if (!safe(sizeBytes) || !safe(offset) || !Number.isInteger(crc32) || crc32 < 0 || crc32 > 0xffffffff) fail("input");
  const local = Buffer.alloc(50 + bytes.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(8, 6);
  local.writeUInt32LE(time, 10); local.writeUInt32LE(0xffffffff, 18); local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(bytes.length, 26); local.writeUInt16LE(20, 28); bytes.copy(local, 30);
  let at = 30 + bytes.length;
  local.writeUInt16LE(1, at); local.writeUInt16LE(16, at + 2);
  local.writeBigUInt64LE(BigInt(sizeBytes), at + 4); local.writeBigUInt64LE(BigInt(sizeBytes), at + 12);
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc32, 4);
  descriptor.writeBigUInt64LE(BigInt(sizeBytes), 8); descriptor.writeBigUInt64LE(BigInt(sizeBytes), 16);
  const central = Buffer.alloc(74 + bytes.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(45, 4); central.writeUInt16LE(45, 6);
  central.writeUInt16LE(8, 8); central.writeUInt32LE(time, 12); central.writeUInt32LE(crc32, 16);
  central.writeUInt32LE(0xffffffff, 20); central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(bytes.length, 28); central.writeUInt16LE(28, 30);
  central.writeUInt32LE(0xffffffff, 42); bytes.copy(central, 46); at = 46 + bytes.length;
  central.writeUInt16LE(1, at); central.writeUInt16LE(24, at + 2);
  central.writeBigUInt64LE(BigInt(sizeBytes), at + 4); central.writeBigUInt64LE(BigInt(sizeBytes), at + 12);
  central.writeBigUInt64LE(BigInt(offset), at + 20);
  return { local, descriptor, central };
}
export function zip64EndRecords(count: number, directoryBytes: number, directoryOffset: number): Buffer {
  if (![count, directoryBytes, directoryOffset].every(safe)) fail("input");
  const endOffset = sum(directoryOffset, directoryBytes), end = Buffer.alloc(98);
  end.writeUInt32LE(0x06064b50, 0); end.writeBigUInt64LE(BigInt(44), 4);
  end.writeUInt16LE(45, 12); end.writeUInt16LE(45, 14);
  end.writeBigUInt64LE(BigInt(count), 24); end.writeBigUInt64LE(BigInt(count), 32);
  end.writeBigUInt64LE(BigInt(directoryBytes), 40); end.writeBigUInt64LE(BigInt(directoryOffset), 48);
  end.writeUInt32LE(0x07064b50, 56); end.writeBigUInt64LE(BigInt(endOffset), 64); end.writeUInt32LE(1, 72);
  end.writeUInt32LE(0x06054b50, 76); end.writeUInt16LE(0xffff, 84); end.writeUInt16LE(0xffff, 86);
  end.writeUInt32LE(0xffffffff, 88); end.writeUInt32LE(0xffffffff, 92);
  return end;
}

function refusedArchive(dispose: () => Promise<void>, deadline: number): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = Promise.race([Promise.resolve().then(dispose), new Promise<never>((_, reject) => {
    const remaining = Number.isSafeInteger(deadline) ? deadline - Date.now() : ARCHIVE_OPERATION_TIMEOUT_MS;
    timer = setTimeout(() => reject(new Zip64Error("cleanup")), Math.max(1, Math.min(ARCHIVE_OPERATION_TIMEOUT_MS, remaining))); timer.unref();
  })]).finally(() => clearTimeout(timer));
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try { await cleanup; controller.error(new Zip64Error("input")); }
      catch { controller.error(new Zip64Error("cleanup")); }
    }, async cancel() { await cleanup; },
  }, { highWaterMark: 0 });
}

/** One source chunk and one central record at a time, with zero output prefetch.
 * Central metadata is spooled, never a materialized member list. Ownership of
 * the supplied spool transfers here, including rejected input. Trailers wait
 * for integrity checks and cleanup. A consumer must require successful stream
 * EOF, not merely a ZIP trailer, and independently recheck final authority.
 * Current source adapters still own immutable content and membership checks. */
export function createZip64Archive(options: Zip64Options): ReadableStream<Uint8Array> {
  const { expectedMemberCount, expectedPayloadBytes, modifiedAt, deadline, authorityReceipt, checkAuthority, members } = options;
  let dispose: Zip64Spool["dispose"] = async () => {}, append: Zip64Spool["append"], replay: Zip64Spool["replay"], selectMembers: () => AsyncIterator<Zip64Member>;
  try {
    if (typeof options.spool?.dispose !== "function") fail("input"); dispose = options.spool.dispose.bind(options.spool);
    if (!safe(expectedMemberCount) || !safe(expectedPayloadBytes) || !Number.isSafeInteger(deadline)
      || deadline <= Date.now() || deadline - Date.now() > 86_400_000 || typeof authorityReceipt !== "string"
      || !hashPattern.test(authorityReceipt) || typeof checkAuthority !== "function" || !(options.signal instanceof AbortSignal)
      || typeof members?.[Symbol.asyncIterator] !== "function" || typeof options.spool.append !== "function" || typeof options.spool.replay !== "function") fail("input");
    dosDate(modifiedAt); selectMembers = members[Symbol.asyncIterator].bind(members);
    append = options.spool.append.bind(options.spool); replay = options.spool.replay.bind(options.spool);
  } catch { return refusedArchive(dispose, deadline); }
  const abort = new AbortController(), signal = AbortSignal.any([options.signal, abort.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, iterator: AsyncIterator<Zip64Member> | undefined;
  let cleanup: Promise<void> | undefined, streamController: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  const active = () => { if (Date.now() >= deadline) fail("deadline"); if (signal.aborted) fail("aborted"); };
  function bestEffortCancel() { try { void reader?.cancel().catch(() => {}); } catch { /* Detached, bounded by operation race. */ } }
  async function operation<T>(code: Failure, work: (current: AbortSignal) => Promise<T>): Promise<T> {
    active(); const local = new AbortController(), current = AbortSignal.any([signal, local.signal]);
    const timer = setTimeout(() => local.abort(), Math.min(ARCHIVE_OPERATION_TIMEOUT_MS, deadline - Date.now())); timer.unref();
    let rejectAbort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Zip64Error(Date.now() >= deadline || local.signal.aborted ? "deadline" : "aborted"));
      current.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      if (current.aborted) rejectAbort();
      const pending = Promise.resolve().then(() => { active(); if (current.aborted) fail("deadline"); return work(current); });
      const value = await Promise.race([pending, cancelled]); active(); if (current.aborted) fail("deadline"); return value;
    } catch (error) { if (error instanceof Zip64Error) throw error; return fail(code); }
    finally { clearTimeout(timer); current.removeEventListener("abort", rejectAbort); local.abort(); }
  }
  const check = async () => { if (await operation("authority", checkAuthority) !== authorityReceipt) fail("authority"); };
  function clean(): Promise<void> {
    if (cleanup) return cleanup;
    bestEffortCancel();
    try { void iterator?.return?.().catch(() => {}); } catch { /* Never wait for a hostile iterator. */ }
    cleanup = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Zip64Error("cleanup")), Math.max(1, Math.min(ARCHIVE_OPERATION_TIMEOUT_MS, deadline - Date.now()))); timer.unref();
      Promise.resolve().then(dispose).then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(new Zip64Error("cleanup")); });
    });
    return cleanup;
  }
  const stopTimer = () => { clearTimeout(deadlineTimer); signal.removeEventListener("abort", onAbort); };
  function onAbort() {
    stopTimer();
    bestEffortCancel(); if (!finished) streamController?.error(new Zip64Error(Date.now() >= deadline ? "deadline" : "aborted"));
    void clean().catch(() => {});
  }
  const deadlineTimer = setTimeout(() => abort.abort(), deadline - Date.now()); deadlineTimer.unref();
  signal.addEventListener("abort", onAbort, { once: true });
  async function* produce() {
    const directoryHash = createHash("sha256"); let directoryBytes = 0, count = 0, payload = 0, offset = 0, previous = "";
    // Strict lexical order lets us retain only prefixes of the current name
    // (at most 255). Reject file/directory collisions without a member-name set.
    let prefixes: string[] = [];
    try {
      await check(); iterator = selectMembers();
      for (;;) {
        await check(); const next = await operation("source", async () => {
          const result = await iterator!.next();
          if (result.done) return { done: true as const };
          if (!record(result.value, "name,open,sizeBytes")) fail("input");
          const { name, sizeBytes, open } = result.value;
          nameBytes(name); if (!safe(sizeBytes) || typeof open !== "function") fail("input");
          return { done: false as const, value: Object.freeze({ name, sizeBytes, open }) };
        }); await check();
        if (next.done) break;
        if (count >= expectedMemberCount) fail("count");
        const { name, sizeBytes, open: openMember } = next.value;
        if (name <= previous) fail("order"); previous = name;
        prefixes = prefixes.filter(prefix => name.startsWith(prefix));
        if (prefixes.some(prefix => name.startsWith(`${prefix}/`))) fail("order");
        prefixes.push(name);
        if (sum(payload, sizeBytes) > expectedPayloadBytes) fail("size");
        const memberOffset = offset, header = zip64MemberHeaders(name, sizeBytes, memberOffset, 0, modifiedAt).local;
        await check();
        const source = await operation("source", async current => {
          const result = await openMember(signal);
          if (current.aborted) { try { void result.cancel().catch(() => {}); } catch {} fail("aborted"); }
          return result;
        });
        reader = source.getReader(); await check(); offset = sum(offset, header.length); yield header;
        let size = 0, crc = 0xffffffff;
        for (;;) {
          await check(); const chunk = await operation("source", async () => {
            const result = await reader!.read();
            if (result.done) return { done: true as const };
            if (!(result.value instanceof Uint8Array) || !result.value.length || result.value.length > ARCHIVE_SEGMENT_BYTES) fail("source");
            return { done: false as const, value: Buffer.from(result.value) };
          }); await check();
          if (chunk.done) break;
          size = sum(size, chunk.value.length); if (size > sizeBytes) fail("size");
          const bytes = chunk.value; crc = crcStep(crc, bytes); active(); offset = sum(offset, bytes.length); yield bytes;
        }
        reader.releaseLock(); reader = undefined;
        if (size !== sizeBytes) fail("size");
        const { descriptor, central } = zip64MemberHeaders(name, size, memberOffset, (crc ^ 0xffffffff) >>> 0, modifiedAt);
        const recordHash = createHash("sha256").update(central).digest("hex");
        directoryHash.update(central);
        await check(); await operation("spool", current => append(central, current)); await check();
        if (createHash("sha256").update(central).digest("hex") !== recordHash) fail("spool");
        directoryBytes = sum(directoryBytes, central.length);
        payload = sum(payload, size); count = sum(count, 1); offset = sum(offset, descriptor.length); yield descriptor;
      }
      if (count !== expectedMemberCount) fail("count"); if (payload !== expectedPayloadBytes) fail("size");
      await check(); reader = replay(signal).getReader(); const observed = createHash("sha256"); let observedBytes = 0;
      for (;;) {
        await check(); const chunk = await operation("spool", async () => {
          const result = await reader!.read();
          if (result.done) return { done: true as const };
          if (!(result.value instanceof Uint8Array) || !result.value.length || result.value.length > ARCHIVE_SEGMENT_BYTES) fail("spool");
          return { done: false as const, value: Buffer.from(result.value) };
        }); await check();
        if (chunk.done) break;
        observedBytes = sum(observedBytes, chunk.value.length); if (observedBytes > directoryBytes) fail("spool");
        const bytes = chunk.value; observed.update(bytes); yield bytes;
      }
      reader.releaseLock(); reader = undefined;
      if (observedBytes !== directoryBytes || observed.digest("hex") !== directoryHash.digest("hex")) fail("spool");
      const end = zip64EndRecords(count, directoryBytes, offset); sum(sum(offset, directoryBytes), end.length);
      await clean(); await check(); yield end; await check();
    } finally { await clean(); }
  }
  const generator = produce();
  return new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; if (signal.aborted) onAbort(); },
    async pull(controller) {
      try { const next = await generator.next(); if (signal.aborted) return; if (next.done) { finished = true; stopTimer(); controller.close(); } else controller.enqueue(next.value); }
      catch (error) { stopTimer(); if (!signal.aborted) controller.error(error instanceof Zip64Error ? error : new Zip64Error("source")); }
    },
    async cancel() { finished = true; stopTimer(); abort.abort(); await clean(); void generator.return(undefined).catch(() => {}); },
  }, { highWaterMark: 0 });
}

/** Optional local metadata spool, never an archive staging file. The path is
 * private and is not returned. ENOSPC/short writes/read errors are failures.
 * Cleanup failure is explicit; removal is not a physical-erasure claim. */
export async function createZip64FileSpool(): Promise<Zip64Spool> {
  const directory = await mkdtemp(join(tmpdir(), "inherit-zip64-"));
  let file;
  try { file = await open(join(directory, "directory.bin"), "wx+", 0o600); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  let bytes = 0, replaying = false, disposed = false, busy = false, disposal: Promise<void> | undefined;
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true; disposal = (async () => { try { await file.close(); } finally { await rm(directory, { recursive: true, force: true }); } })(); return disposal;
  };
  return Object.freeze({
    async append(record: Uint8Array, signal: AbortSignal) {
      if (disposed || replaying || busy || signal.aborted || !(record instanceof Uint8Array) || record.length < 74 || record.length > 329) fail("spool");
      busy = true; const owned = Buffer.from(record);
      try {
        let written = 0; sum(bytes, owned.length);
        while (written < owned.length) {
          if (disposed || signal.aborted) fail("spool");
          const result = await file.write(owned, written, owned.length - written, bytes + written);
          if (!result.bytesWritten || disposed || signal.aborted) fail("spool"); written += result.bytesWritten;
        }
        bytes += written;
      } finally { busy = false; }
    },
    replay(signal: AbortSignal) {
      if (disposed || replaying || busy || signal.aborted) fail("spool"); replaying = true; let offset = 0;
      return new ReadableStream<Uint8Array>({ async pull(controller) {
        try {
          if (disposed || signal.aborted) fail("spool");
          if (offset === bytes) { controller.close(); return; }
          const buffer = Buffer.alloc(Math.min(65_536, bytes - offset));
          const result = await file.read(buffer, 0, buffer.length, offset);
          if (!result.bytesRead || disposed || signal.aborted) fail("spool");
          offset += result.bytesRead; controller.enqueue(buffer.subarray(0, result.bytesRead));
        } catch { controller.error(new Zip64Error("spool")); }
      } }, { highWaterMark: 0 });
    }, dispose,
  });
}
