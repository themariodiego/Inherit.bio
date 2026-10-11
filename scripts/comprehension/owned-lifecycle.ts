/** Public latest observations, never an authority, outcome or recovery proof.
 * Synchronous bounded writes survive a later child/PGID termination. A torn
 * write is refused by the reader; an entered operation is not a failure. */
import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync,
  readSync, realpathSync, writeSync, type Stats } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assertOwnedLinuxCapability, type OwnedLinuxCapability } from "../owned-linux-runtime";

export const OWNED_LIFECYCLE_LIMITS = Object.freeze({ lines: 2, lineBytes: 512, fileBytes: 1024 });
const phases = ["source-guard", "configuration", "runtime-guard", "journal-open", "reservation",
  "bootstrap-acquisition", "bootstrap-keys", "production-build", "bootstrap-cleanup",
  "post-build-source", "isolation", "record-create", "session-setup", "run-completion", "journal-close", "between-operations"] as const;
const signals = ["SIGABRT", "SIGALRM", "SIGBUS", "SIGHUP", "SIGINT", "SIGKILL", "SIGPIPE",
  "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGXCPU", "SIGXFSZ"] as const;
const classification = z.enum(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit", "setup-refused"]);
const code = z.number().int().min(0).max(255).nullable();
const signal = z.enum(signals).nullable();
const headerSchema = z.object({ version: z.literal(1), nonce: z.string().uuid(), bootId: z.string().uuid(),
  head: z.string().regex(/^[a-f0-9]{40}$/), uid: z.number().int().positive().safe(), gid: z.number().int().positive().safe(),
  createdAt: z.number().int().nonnegative().safe() }).strict();
const stateSchema = z.object({ sequence: z.number().int().positive().safe(), phase: z.enum(phases),
  event: z.enum(["entered", "returned", "refused"]), classification: classification.nullable(),
  exitCode: code, signal, elapsedMs: z.number().int().nonnegative().safe(),
  process: z.object({ ordinal: z.number().int().nonnegative().safe(),
    event: z.enum(["none", "requested", "spawned", "terminal", "error", "kill-requested"]),
    exitCode: code, signal, durationMs: z.number().int().nonnegative().safe(),
    sender: z.enum(["command-deadline", "command-output-limit"]).nullable() }).strict(),
  firstRefusal: z.tuple([z.enum(phases), classification, code, signal]).nullable(),
}).strict();
type Header = z.infer<typeof headerSchema>;
type State = z.infer<typeof stateSchema>;
export type OwnedLifecycleObserver = {
  phase(phase: State["phase"], event: State["event"], metadata?: unknown): void;
  failure(metadata: unknown): void;
  process(event: State["process"]["event"], exitCode?: number | null, signal?: string | null,
    sender?: State["process"]["sender"]): void;
};

function plain(input: unknown, fields: readonly string[]) {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !fields.includes(key))
      || fields.some(key => !descriptors[key] || !("value" in descriptors[key]))) return null;
    return Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
  } catch { return null; }
}
function refusal(input: unknown) {
  // The branded classifier can contain other public runtime fields. Only these
  // three own data fields are selected; no accessor, message or output is read.
  try {
    const own = (name: string) => input !== null && typeof input === "object"
      ? Object.getOwnPropertyDescriptor(input, name)?.value : undefined;
    const value = own("classification");
    const parsed = z.object({ classification, exitCode: code, signal }).strict().safeParse({
      classification: value === "guard-refused" || value === "invalid-response" ? "setup-refused" : value,
      exitCode: own("exitCode"), signal: own("signal"),
    });
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
function encode(header: Header, state: State) {
  const lines = [JSON.stringify(header), JSON.stringify(state)];
  assert(lines.every(line => Buffer.byteLength(line) + 1 <= OWNED_LIFECYCLE_LIMITS.lineBytes));
  const bytes = Buffer.from(lines.join("\n") + "\n");
  assert(bytes.length <= OWNED_LIFECYCLE_LIMITS.fileBytes);
  return bytes;
}

/** Pure injection surface for authored controls; it mints no native capability.
 * Sink/clock errors are diagnostic uncertainty and never replace an operation. */
export function createOwnedLifecycleObserver(input: unknown, sink: (bytes: Uint8Array) => void,
  clock: () => number = () => performance.now()): OwnedLifecycleObserver {
  const projected = plain(input, ["version", "nonce", "bootId", "head", "uid", "gid", "createdAt"]);
  const header = headerSchema.parse(projected), start = clock();
  let state: State = { sequence: 1, phase: "source-guard", event: "entered", classification: null,
    exitCode: null, signal: null, elapsedMs: 0,
    process: { ordinal: 0, event: "none", exitCode: null, signal: null, durationMs: 0, sender: null }, firstRefusal: null };
  let processStarted = start;
  const write = (next: State) => {
    try {
      const parsed = stateSchema.safeParse(next);
      if (!parsed.success) return;
      const bytes = encode(header, parsed.data); sink(bytes); state = parsed.data;
    } catch { /* No telemetry refusal replaces a real operation/refusal/cleanup. */ }
  };
  return {
    phase(phase, event, metadata) {
      try {
        const failed = event === "refused" ? refusal(metadata) : null;
        if (event === "refused" && !failed) return;
        write({ ...state, sequence: state.sequence + 1, phase, event,
          classification: failed?.classification ?? null, exitCode: failed?.exitCode ?? null,
          signal: failed?.signal ?? null, elapsedMs: Math.floor(clock() - start),
          firstRefusal: state.firstRefusal ?? (failed ? [phase, failed.classification, failed.exitCode, failed.signal] : null) });
      } catch { /* Unknown/accessor input is not forwarded. */ }
    },
    failure(metadata) {
      // A failure outside an entered instrumented operation remains explicitly
      // between operations; a preceding returned phase is never blamed for it.
      this.phase(state.event === "entered" ? state.phase : "between-operations", "refused", metadata);
    },
    process(event, exitCode = null, actualSignal = null, sender = null) {
      try {
        const observedAt = clock();
        if (event === "requested") processStarted = observedAt;
        write({ ...state, sequence: state.sequence + 1, elapsedMs: Math.floor(observedAt - start),
          process: { ordinal: state.process.ordinal + (event === "requested" ? 1 : 0), event,
            exitCode, signal: actualSignal as State["process"]["signal"],
            durationMs: Math.floor(observedAt - processStarted),
            sender: event === "requested" ? null : sender ?? state.process.sender } });
      } catch { /* Actual fixed caller facts only; unknown values are discarded. */ }
    },
  };
}

export function observeOwnedLifecycleProcess(observer: OwnedLifecycleObserver | undefined,
  ...facts: Parameters<OwnedLifecycleObserver["process"]>) {
  try { observer?.process(...facts); } catch { /* Original command behavior remains. */ }
}
export function observeOwnedLifecyclePhase(observer: OwnedLifecycleObserver | undefined,
  ...facts: Parameters<OwnedLifecycleObserver["phase"]>) {
  try { observer?.phase(...facts); } catch { /* Original operation/cleanup remains. */ }
}
export function observeOwnedLifecycleFailure(observer: OwnedLifecycleObserver | undefined, metadata: unknown) {
  try { observer?.failure(metadata); } catch { /* Same original exception remains. */ }
}
const filename = (nonce: string) => `owned-lifecycle-${z.string().uuid().parse(nonce)}.jsonl`;
const identity = (stat: Stats) =>
  [stat.dev, stat.ino, stat.uid, stat.gid, stat.mode, stat.nlink] as const;
function scratch(directory: string, uid: number, gid: number) {
  assert(path.isAbsolute(directory) && path.resolve(directory) === directory && realpathSync(directory) === directory);
  const stat = lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid && stat.gid === gid
    && (stat.mode & 0o7777) === 0o700);
  return identity(stat);
}

/** Only the genuine existing capability opens the single public owned file.
 * An unavailable diagnostic cannot create a substitute runtime authority. */
export function openOwnedLifecycle(capability: OwnedLinuxCapability | undefined):
  { observer: OwnedLifecycleObserver; close(): void } | undefined {
  if (!capability) return;
  let fd: number | undefined;
  try {
    assertOwnedLinuxCapability(capability);
    const proof = capability.proof, directory = proof.scratch, parent = scratch(directory, proof.uid, proof.gid);
    const file = path.join(directory, filename(proof.nonce));
    fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const opened = fstatSync(fd), original = identity(opened);
    assert(opened.isFile() && opened.nlink === 1 && opened.uid === proof.uid && opened.gid === proof.gid
      && (opened.mode & 0o7777) === 0o600);
    const descriptor = fd;
    const header: Header = { version: 1, nonce: proof.nonce, bootId: proof.bootId, head: proof.head,
      uid: proof.uid, gid: proof.gid, createdAt: Date.now() };
    let closed = false, uncertain = false;
    const check = () => {
      assert(!closed && !uncertain);
      assert.deepEqual(scratch(directory, proof.uid, proof.gid), parent);
      const named = lstatSync(file), held = fstatSync(descriptor);
      assert(named.isFile() && !named.isSymbolicLink());
      assert.deepEqual(identity(named), original); assert.deepEqual(identity(held), original);
    };
    const observer = createOwnedLifecycleObserver(header, bytes => {
      try {
        check(); assert(bytes.byteLength <= OWNED_LIFECYCLE_LIMITS.fileBytes);
        assert(writeSync(descriptor, bytes, 0, bytes.byteLength, 0) === bytes.byteLength);
        ftruncateSync(descriptor, bytes.byteLength); fsyncSync(descriptor); check();
      } catch { uncertain = true; throw new Error("Public lifecycle write refused"); }
    });
    return { observer, close() { if (!closed) { closed = true; try { closeSync(descriptor); } catch { /* Telemetry only. */ } } } };
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* No original authority change. */ }
    return undefined;
  }
}

export function parseOwnedLifecycleSnapshot(raw: Uint8Array, expected: Omit<Header, "version" | "createdAt">,
  lifetime: { startedAt: number; endedAt: number }) {
  assert(raw.byteLength > 0 && raw.byteLength <= OWNED_LIFECYCLE_LIMITS.fileBytes);
  assert([...raw].every(byte => byte === 10 || byte >= 32 && byte <= 126));
  const lines = Buffer.from(raw).toString("ascii").split("\n");
  assert(lines.length === 3 && lines[2] === ""
    && lines.slice(0, 2).every(line => Buffer.byteLength(line) + 1 <= OWNED_LIFECYCLE_LIMITS.lineBytes));
  const header = headerSchema.parse(JSON.parse(lines[0])), state = stateSchema.parse(JSON.parse(lines[1]));
  assert.deepEqual({ nonce: header.nonce, bootId: header.bootId, head: header.head, uid: header.uid, gid: header.gid }, expected);
  assert(Number.isSafeInteger(lifetime.startedAt) && Number.isSafeInteger(lifetime.endedAt)
    && lifetime.startedAt <= header.createdAt && header.createdAt <= lifetime.endedAt);
  assert(Buffer.from(raw).equals(encode(header, state)), "Exact canonical complete lifecycle snapshot required");
  return { header, latest: state, completeHistory: false as const, qualifyingEvidence: false as const };
}

/** Called after actual launcher close and owned-group settlement. No alternate
 * path or arbitrary filename is accepted. Read refusal is never flow success. */
export function readOwnedLifecycleSnapshot(input: { scratch: string; nonce: string; bootId: string; head: string;
  uid: number; gid: number; startedAt: number; endedAt: number }) {
  let fd: number | undefined;
  try {
    const parent = scratch(input.scratch, input.uid, input.gid), file = path.join(input.scratch, filename(input.nonce));
    try { lstatSync(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" as const };
      throw error;
    }
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd), named = lstatSync(file);
    assert(before.isFile() && !named.isSymbolicLink() && before.nlink === 1 && before.uid === input.uid
      && before.gid === input.gid && (before.mode & 0o7777) === 0o600 && before.size > 0
      && before.size <= OWNED_LIFECYCLE_LIMITS.fileBytes);
    assert.deepEqual(identity(named), identity(before));
    const stamp = (stat: typeof before) => [...identity(stat), stat.size, stat.mtimeMs, stat.ctimeMs];
    const bounded = Buffer.alloc(OWNED_LIFECYCLE_LIMITS.fileBytes + 1);
    let size = 0, count: number;
    while ((count = readSync(fd, bounded, size, bounded.length - size, size)) > 0) {
      size += count; assert(size <= OWNED_LIFECYCLE_LIMITS.fileBytes);
    }
    const raw = bounded.subarray(0, size);
    assert(size === before.size);
    assert.deepEqual(stamp(fstatSync(fd)), stamp(before)); assert.deepEqual(stamp(lstatSync(file)), stamp(before));
    assert.deepEqual(scratch(input.scratch, input.uid, input.gid), parent);
    assert(before.mtimeMs >= input.startedAt && before.ctimeMs >= input.startedAt
      && before.mtimeMs <= input.endedAt && before.ctimeMs <= input.endedAt);
    const parsed = parseOwnedLifecycleSnapshot(raw, { nonce: input.nonce, bootId: input.bootId, head: input.head,
      uid: input.uid, gid: input.gid }, input);
    return { status: "observed" as const, ...parsed };
  } catch { return { status: "refused" as const }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* Original cleanup is independent. */ } }
}
