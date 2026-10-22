import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelocationRpc } from "@/lib/future-person/relocation-worker";

const ranges = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/uploads/subject-original-download", () => ({ readGenomeObjectRange: ranges.read }));
const {
  runNextSubjectObjectRelocation, runNextSubjectTransferRelocation, supabaseTransferStorage,
} = await import("./transfer-relocation-worker");
type TransferStorage = import("./transfer-relocation-worker").TransferStorage;

const signal = () => new AbortController().signal;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
beforeEach(() => vi.stubEnv("INHERIT_TEST_JURISDICTION", "1"));
afterEach(() => vi.unstubAllEnvs());

function fixture(kind: "copy" | "retire" | "dispose" = "copy") {
  const relocationId = randomUUID(), attemptId = randomUUID(), oldKey = randomUUID(), objectId = randomUUID();
  const bytes = "##fileformat=VCFv4.2 synthetic transfer\n";
  const target = { relocationId, attemptId, bucket: "genomes", oldKey, newKey: attemptId, byteCount: bytes.length,
    sha256: sha(bytes), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const work = kind === "copy" ? { kind, relocationId } : kind === "retire" ? { kind, relocationId } : { kind, attemptId };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const answers = new Map<string, unknown>([
    ["subject_transfer_relocation_work_v1", work], ["claim_subject_transfer_relocation_v1", target],
    ["check_subject_transfer_relocation_v1", true], ["swap_subject_transfer_relocation_v1", true],
    ["fence_subject_transfer_relocation_v1", true],
    ["claim_subject_transfer_retirement_v1", { relocationId, bucket: "genomes", key: oldKey }],
    ["finish_subject_transfer_retirement_v1", true],
    ["claim_subject_transfer_disposal_v1", { attemptId, bucket: "genomes", key: attemptId }],
    ["finish_subject_transfer_disposal_v1", true],
  ]);
  const rpc: RelocationRpc = (name, args) => ({
    abortSignal: async () => {
      calls.push({ name, args });
      const value = answers.get(name);
      return value instanceof Error ? { data: null, error: value } : { data: value ?? null, error: null };
    },
  });
  const order: string[] = [];
  const storage = {
    copy: vi.fn(async (from: string, to: string) => { order.push(`copy ${from} ${to}`); }),
    objectId: vi.fn(async (key: string) => { order.push(`info ${key}`); return objectId; }),
    digest: vi.fn(async (key: string) => { order.push(`read ${key}`); return { bytes: bytes.length, sha256: sha(bytes) }; }),
    remove: vi.fn(async (key: string) => { order.push(`remove ${key}`); }),
  } satisfies TransferStorage;
  return { relocationId, attemptId, oldKey, objectId, bytes, target, calls, answers, rpc, storage, order };
}
const names = (f: ReturnType<typeof fixture>) => f.calls.map(call => call.name);

describe("the subject-transfer relocation branch", () => {
  it("runs only under TEST-LOCAL, and is idle with no work", async () => {
    const f = fixture();
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "0");
    await expect(runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).rejects.toThrow();
    expect(f.calls).toEqual([]);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    f.answers.set("subject_transfer_relocation_work_v1", null);
    expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("idle");
    expect(f.order).toEqual([]);
  });

  it("copies to the database's fresh key, reads every byte back and swaps only the exact verified copy", async () => {
    const f = fixture();
    expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("swapped");
    expect(names(f)).toEqual(["subject_transfer_relocation_work_v1", "claim_subject_transfer_relocation_v1",
      "check_subject_transfer_relocation_v1", "check_subject_transfer_relocation_v1", "check_subject_transfer_relocation_v1",
      "swap_subject_transfer_relocation_v1"]);
    expect(f.order).toEqual([`copy ${f.oldKey} ${f.attemptId}`, `read ${f.attemptId}`, `info ${f.attemptId}`]);
    const swap = f.calls.at(-1)!.args;
    expect(swap).toMatchObject({ p_attempt_id: f.attemptId, p_new_object_id: f.objectId, p_byte_count: f.bytes.length,
      p_sha256: sha(f.bytes), p_test_jurisdiction: true });
    expect(swap.p_token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(f.calls.every(call => call.args.p_test_jurisdiction === true)).toBe(true);
    expect(f.storage.remove).not.toHaveBeenCalled();
  });

  it("fences only its own attempt when authority goes stale, the bytes differ or a transport fails", async () => {
    for (const failure of ["stale", "size", "hash", "copy", "read", "info", "swap"]) {
      const f = fixture();
      if (failure === "stale") f.answers.set("check_subject_transfer_relocation_v1", false);
      if (failure === "size") f.storage.digest.mockResolvedValue({ bytes: f.bytes.length + 1, sha256: sha(f.bytes) });
      if (failure === "hash") f.storage.digest.mockResolvedValue({ bytes: f.bytes.length, sha256: sha("other") });
      if (failure === "copy") f.storage.copy.mockRejectedValue(new Error("synthetic copy failure"));
      if (failure === "read") f.storage.digest.mockRejectedValue(new Error("synthetic read failure"));
      if (failure === "info") f.storage.objectId.mockRejectedValue(new Error("synthetic info failure"));
      if (failure === "swap") f.answers.set("swap_subject_transfer_relocation_v1", false);
      expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("failure_pending");
      expect(names(f).at(-1)).toBe("fence_subject_transfer_relocation_v1");
      expect(f.calls.at(-1)!.args).toMatchObject({ p_attempt_id: f.attemptId });
      expect(f.storage.remove).not.toHaveBeenCalled();
      if (failure !== "swap") expect(names(f)).not.toContain("swap_subject_transfer_relocation_v1");
    }
  });

  it("refuses a claim that is not the queued row, or whose new key is not its own attempt, before any copy", async () => {
    for (const change of [{ relocationId: randomUUID() }, { newKey: randomUUID() }, { bucket: "exports" }, { oldKey: "a/b" }]) {
      const f = fixture();
      f.answers.set("claim_subject_transfer_relocation_v1", { ...f.target, ...change });
      expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("failure_pending");
      expect(f.order).toEqual([]);
    }
  });

  it("is idle when another worker holds the claim", async () => {
    const f = fixture();
    f.answers.set("claim_subject_transfer_relocation_v1", null);
    expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("idle");
    expect(f.order).toEqual([]);
  });

  it("retires only the exact old object, and only after the database names it", async () => {
    const f = fixture("retire");
    expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("complete");
    expect(names(f)).toEqual(["subject_transfer_relocation_work_v1", "claim_subject_transfer_retirement_v1",
      "finish_subject_transfer_retirement_v1"]);
    expect(f.order).toEqual([`remove ${f.oldKey}`]);
    const g = fixture("retire");
    g.storage.remove.mockRejectedValue(new Error("synthetic remove failure"));
    await expect(runNextSubjectTransferRelocation({ signal: signal(), rpc: g.rpc, storage: g.storage })).rejects.toThrow();
    expect(names(g)).not.toContain("finish_subject_transfer_retirement_v1");
    const h = fixture("retire");
    h.answers.set("claim_subject_transfer_retirement_v1", { relocationId: randomUUID(), bucket: "genomes", key: h.oldKey });
    await expect(runNextSubjectTransferRelocation({ signal: signal(), rpc: h.rpc, storage: h.storage })).rejects.toThrow();
    expect(h.order).toEqual([]);
  });

  it("disposes of only a fenced attempt's own new key", async () => {
    const f = fixture("dispose");
    expect(await runNextSubjectTransferRelocation({ signal: signal(), rpc: f.rpc, storage: f.storage })).toBe("cleaned");
    expect(f.order).toEqual([`remove ${f.attemptId}`]);
    expect(names(f).at(-1)).toBe("finish_subject_transfer_disposal_v1");
    const g = fixture("dispose");
    g.answers.set("claim_subject_transfer_disposal_v1", { attemptId: g.attemptId, bucket: "genomes", key: g.oldKey });
    await expect(runNextSubjectTransferRelocation({ signal: signal(), rpc: g.rpc, storage: g.storage })).rejects.toThrow();
    expect(g.order).toEqual([]);
  });
});

describe("the registered subject-object-relocation worker", () => {
  it("lets both branches take turns going first, and returns the first that worked", async () => {
    const futurePerson = vi.fn(async () => "complete" as const);
    const transfer = vi.fn(async () => "swapped" as const);
    const first = await runNextSubjectObjectRelocation({ signal: signal(), futurePerson, transfer });
    const second = await runNextSubjectObjectRelocation({ signal: signal(), futurePerson, transfer });
    expect(new Set([first, second])).toEqual(new Set(["complete", "swapped"]));
    expect(futurePerson).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it("runs the other branch when one fails, and still reports the failure", async () => {
    const transfer = vi.fn(async () => "idle" as const);
    const futurePerson = vi.fn(async () => { throw new Error("synthetic branch failure"); });
    await expect(runNextSubjectObjectRelocation({ signal: signal(), futurePerson, transfer })).rejects.toThrow();
    expect(transfer).toHaveBeenCalledTimes(1);
    const working = vi.fn(async () => "complete" as const);
    for (let i = 0; i < 2; i += 1) {
      expect(await runNextSubjectObjectRelocation({ signal: signal(), futurePerson, transfer: working })).toBe("complete");
    }
  });

  it("is idle only when both branches are", async () => {
    const idle = vi.fn(async () => "idle" as const);
    expect(await runNextSubjectObjectRelocation({ signal: signal(), futurePerson: idle, transfer: idle })).toBe("idle");
    expect(idle).toHaveBeenCalledTimes(2);
  });
});

describe("the Storage read-back", () => {
  const object = Buffer.alloc(9 * 1024 * 1024 + 17, 7);
  const ranged = (bytes: Buffer, total = bytes.length, header?: (start: number, end: number) => string) =>
    async (_key: string, start: number, end: number) => new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206, headers: { "content-range": header ? header(start, end) : `bytes ${start}-${end}/${total}` },
    });

  it("hashes every byte of the new object in bounded ranges", async () => {
    ranges.read.mockImplementation(ranged(object));
    const key = randomUUID();
    expect(await supabaseTransferStorage().digest(key, object.length, signal())).toEqual({
      bytes: object.length, sha256: createHash("sha256").update(object).digest("hex"),
    });
    expect(ranges.read.mock.calls.map(call => [call[0], call[1], call[2]])).toEqual([
      [key, 0, 8 * 1024 * 1024 - 1], [key, 8 * 1024 * 1024, object.length - 1]]);
  });

  it("refuses a short body, a foreign range or a different object length", async () => {
    const storage = supabaseTransferStorage();
    ranges.read.mockImplementation(async (_key: string, start: number, end: number) => new Response(
      new Uint8Array(object.subarray(start, end)), { status: 206, headers: { "content-range": `bytes ${start}-${end}/${object.length}` } }));
    await expect(storage.digest(randomUUID(), object.length, signal())).rejects.toThrow();
    ranges.read.mockImplementation(ranged(object, object.length, (start, end) => `bytes ${start + 1}-${end}/${object.length}`));
    await expect(storage.digest(randomUUID(), object.length, signal())).rejects.toThrow();
    ranges.read.mockImplementation(ranged(object, object.length + 1));
    await expect(storage.digest(randomUUID(), object.length, signal())).rejects.toThrow();
    ranges.read.mockImplementation(async () => new Response("whole", { status: 200 }));
    await expect(storage.digest(randomUUID(), 5, signal())).rejects.toThrow();
  });
});
