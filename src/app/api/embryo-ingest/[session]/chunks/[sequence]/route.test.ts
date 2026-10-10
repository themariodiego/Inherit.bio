import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `PUT /api/embryo-ingest/[session]/chunks/[sequence]` against a mocked
 * database and a double of the fragment store, to reach every branch of the
 * route's reserve, targets, write and commit order. `route.r2.test.ts` runs
 * the same route through the real R2 writer and gateway. Chunks come from the
 * real browser rewrite over a synthetic three-sample VCF; every SYNTHETIC or
 * PRIVATE label is invented here.
 */
const ACCOUNT = "12345678-1234-4234-8234-000000000001";
const AUTH_SESSION = "12345678-1234-4234-8234-0000000000a1";
const SESSION = "12345678-1234-4234-8234-0000000000c1";
const COHORT = "12345678-1234-4234-8234-0000000000e1";
const ORIGIN = "https://inherit.bio";
const COOKIE_VALUE = "C".repeat(43);
const sha = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const CHALLENGE = crypto.randomBytes(32).toString("base64url");
const HANDLES = [0, 1, 2].map(() => crypto.randomBytes(32).toString("base64url"));
const REVISION = 912_345;

type Receipt = {
  version: "embryo-ingest-write-target-v1"; sessionId: string; sequence: number; ordinal: number;
  backend: "r2" | "supabase"; bucket: string; objectKey: string; byteCount: number; sha256: string; writeExpiresAt: string;
};
type Target = { ordinal: number; state: "open" | "landed" | "uncertain"; receipt: Receipt };
const mocks = vi.hoisted(() => ({
  account: null as { user: { id: string }; sessionId: string } | null,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  results: {} as Record<string, { data: unknown; error: { code?: string } | null }>,
  store: null as null | {
    targets: (session: string, sequence: number) => Promise<unknown>;
    write: (target: Target, bytes: Uint8Array, signal: AbortSignal) => Promise<string>;
  },
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => mocks.account,
}));
vi.mock("@/lib/embryos/fragment-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/embryos/fragment-store")>()),
  embryoFragmentStore: () => mocks.store,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ name, args });
      const result = mocks.results[name];
      if (!result) throw new Error(`unexpected rpc ${name}`);
      return result;
    },
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ id, jurisdiction_code: "GB" })), error: null,
    }) }) }),
  }),
}));

vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");

const { PUT } = await import("./route");
const { embryoVcfChunks } = await import("@/lib/embryos/vcf-transport");

const SOURCE = [
  "##fileformat=VCFv4.2", "##reference=GRCh38", "##SAMPLE=<ID=PRIVATE_SAMPLE>",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_A\tSYNTHETIC_B\tSYNTHETIC_C",
  "chr1\t1000\trs1\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:10\t1/1:12\t0/0:9",
  "chr2\t2000\t.\tC\tT\t.\tPASS\tPRIVATE_NOTE=1\tGT\t0/0\t0/1\t./.", "",
].join("\n");

async function browserChunk(overrides: Partial<{ challenge: string; handles: string[] }> = {}) {
  const [chunk] = await Array.fromAsync(embryoVcfChunks(new Blob([SOURCE]), {
    challenge: CHALLENGE, revision: REVISION, build: "GRCh38", sampleCount: 3, handles: HANDLES, ...overrides,
  }));
  return chunk;
}

function authorized() {
  return {
    status: "authorized", session: SESSION, cohortId: COHORT, uploadId: "12345678-1234-4234-8234-0000000000d1",
    ingestRevision: 4, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), challengeHash: sha(CHALLENGE),
    transportRevision: REVISION, build: "GRCh38", format: "vcf", sampleCount: 3,
    handles: HANDLES.map((handle, ordinal) => ({ ordinal, hash: sha(handle) })),
  };
}

function put(body: Uint8Array | string, headers: Record<string, string> = {}, sequence = "0") {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Request(`${ORIGIN}/api/embryo-ingest/${SESSION}/chunks/${sequence}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength), cookie: `inherit-ingest-${SESSION}=${COOKIE_VALUE}`, ...headers,
    },
    body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
  });
}

function call(request: Request, sequence = "0") {
  return PUT(request, { params: Promise.resolve({ session: SESSION, sequence }) });
}

const named = (name: string) => mocks.calls.filter((entry) => entry.name === name);

type Fragment = { ordinal: number; bytes: number; lines: number; sha256: string };
const KEYS = [0, 1, 2].map(() => `embryo/${crypto.randomUUID()}`);

/**
 * A double of the fragment store over what the reservation recorded: one
 * receipt per reserved fragment, `open` until written and then `landed`.
 * `outcomes` scripts successive writes; `receipts` rewrites what it reports.
 */
function memoryStore(behaviour: {
  outcomes?: string[]; throwOnTargets?: boolean; answer?: unknown;
  receipts?: (receipt: Receipt) => Receipt; states?: Record<number, Target["state"]>;
} = {}) {
  const landed = new Set<number>(Object.entries(behaviour.states ?? {})
    .filter(([, state]) => state === "landed").map(([ordinal]) => Number(ordinal)));
  const written: { target: Target; bytes: Uint8Array; copy: Uint8Array; signal: AbortSignal }[] = [];
  const outcomes = [...(behaviour.outcomes ?? [])];
  const reserved = () => (named("reserve_embryo_ingest_chunk_v1").at(-1)?.args.p_fragments ?? []) as Fragment[];
  const store = {
    written, landed,
    targets: vi.fn(async (session: string, sequence: number) => {
      if (behaviour.throwOnTargets) throw new Error("PRIVATE targets failure");
      if (behaviour.answer) return behaviour.answer;
      return {
        status: "reserved",
        targets: reserved().map((fragment) => {
          const receipt: Receipt = {
            version: "embryo-ingest-write-target-v1", sessionId: session, sequence, ordinal: fragment.ordinal,
            backend: "r2", bucket: "inherit-embryo-test", objectKey: KEYS[fragment.ordinal], byteCount: fragment.bytes,
            sha256: fragment.sha256, writeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          };
          const state = behaviour.states?.[fragment.ordinal] ?? (landed.has(fragment.ordinal) ? "landed" : "open");
          return { ordinal: fragment.ordinal, state, receipt: behaviour.receipts ? behaviour.receipts(receipt) : receipt };
        }),
      };
    }),
    write: vi.fn(async (target: Target, bytes: Uint8Array, signal: AbortSignal) => {
      const outcome = outcomes.shift() ?? "landed";
      if (outcome === "landed") landed.add(target.ordinal);
      written.push({ target, bytes, copy: bytes.slice(), signal });
      return outcome;
    }),
  };
  return store;
}

let store = memoryStore();
beforeEach(() => {
  mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
  mocks.calls = [];
  store = memoryStore();
  mocks.store = store;
  mocks.results = {
    authorize_embryo_ingest_request_v1: { data: authorized(), error: null },
    fail_embryo_ingest_attempt_v1: { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null },
    prepare_embryo_ingest_unwind_v1: { data: { status: "storage_pending" }, error: null },
    reserve_embryo_ingest_chunk_v1: { data: { status: "reserved", objects: [0, 1, 2].map((ordinal) => ({
      ordinal, objectId: crypto.randomUUID() })) }, error: null },
    commit_embryo_ingest_chunk_v1: { data: { status: "stored" }, error: null },
  };
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
});

describe("authority before a byte is read", () => {
  it("refuses with no account, cross-site, or outside TEST-LOCAL, and touches nothing", async () => {
    const bytes = await browserChunk();
    mocks.account = null;
    expect((await call(put(bytes))).status).toBe(401);
    mocks.account = { user: { id: ACCOUNT }, sessionId: AUTH_SESSION };
    expect((await call(put(bytes, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await call(put(bytes))).status).toBe(403);
    expect(mocks.calls).toEqual([]);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("refuses with the retryable 503 while no fragment store is configured, before authorizing anything", async () => {
    mocks.store = null;
    const request = put(await browserChunk());
    expect((await call(request)).status).toBe(503);
    expect(mocks.calls).toEqual([]);
    expect(request.bodyUsed).toBe(false);
  });

  it("answers a missing cookie or a foreign session with the opaque 404, reading nothing", async () => {
    const bytes = await browserChunk();
    expect((await call(put(bytes, { cookie: "" }))).status).toBe(404);
    mocks.results.authorize_embryo_ingest_request_v1 = { data: null, error: { code: "42501" } };
    const request = put(bytes);
    expect((await call(request)).status).toBe(404);
    expect(request.bodyUsed).toBe(false);
    expect(named("reserve_embryo_ingest_chunk_v1")).toEqual([]);
  });

  it("dispatches the unwind for an attempt already failure-pending", async () => {
    mocks.results.authorize_embryo_ingest_request_v1 = { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    const request = put(await browserChunk());
    expect((await call(request)).status).toBe(404);
    expect(request.bodyUsed).toBe(false);
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args)).toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
  });
});

describe("terminal branches, recorded before any reservation or write", () => {
  async function expectTerminal(response: Response, code: string, status: number, body: unknown) {
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(named("fail_embryo_ingest_attempt_v1").map((entry) => entry.args.p_code)).toEqual([code]);
    expect(named("fail_embryo_ingest_attempt_v1")[0].args).toMatchObject({
      p_account_id: ACCOUNT, p_auth_session_id: AUTH_SESSION, p_ingest_session_id: SESSION,
      p_cookie_hash: sha(COOKIE_VALUE), p_origin: ORIGIN, p_cohort_id: COHORT, p_ingest_revision: 4, p_test_jurisdiction: true,
    });
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
    expect(named("reserve_embryo_ingest_chunk_v1")).toEqual([]);
    expect(store.write).not.toHaveBeenCalled();
  }

  it("fails an encoded or mistyped envelope as a framing failure", async () => {
    const bytes = await browserChunk();
    await expectTerminal(await call(put(bytes, { "content-type": "text/plain" })), "chunk", 422,
      { error: "invalid_genetic_chunk", issues: ["framing"] });
  });

  it("fails a noncanonical sequence", async () => {
    await expectTerminal(await call(put(await browserChunk(), {}, "01"), "01"), "chunk", 422,
      { error: "invalid_genetic_chunk", issues: ["framing"] });
  });

  it("fails an over-limit chunk as a limit, before reading it", async () => {
    await expectTerminal(await call(put(await browserChunk(), { "content-length": "4000001" })), "limit", 413, { error: "too_large" });
  });

  it("fails a chunk bound to another challenge as a header failure", async () => {
    await expectTerminal(await call(put(await browserChunk({ challenge: crypto.randomBytes(32).toString("base64url") }))),
      "header", 422, { error: "invalid_genetic_chunk", issues: ["header"] });
  });

  it("fails a chunk naming a handle this session never issued", async () => {
    await expectTerminal(await call(put(await browserChunk({ handles: [HANDLES[0], HANDLES[1], crypto.randomBytes(32).toString("base64url")] }))),
      "header", 422, { error: "invalid_genetic_chunk", issues: ["header"] });
  });

  it("fails a record the browser rewrite would never produce", async () => {
    const text = new TextDecoder().decode(await browserChunk()).replace("\t0/1:10:.:.:.:.", "\t0/1:10:.:.:.:.:PRIVATE");
    const response = await call(put(text));
    expect(response.status).toBe(422);
    expect(named("fail_embryo_ingest_attempt_v1")).toHaveLength(1);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("fails a PDF as a format failure with the registered 415", async () => {
    await expectTerminal(await call(put("%PDF-1.7\n")), "format", 415, { error: "pdf_not_data" });
  });

  it("never answers a terminal branch it could not record", async () => {
    mocks.results.fail_embryo_ingest_attempt_v1 = { data: null, error: { code: "55P03" } };
    const response = await call(put(await browserChunk({ challenge: crypto.randomBytes(32).toString("base64url") })));
    expect(response.status).toBe(503);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });
});

describe("reserve, targets, write, commit", () => {
  it("reserves exactly what it validated, lands each fragment at its receipt, commits, and answers 204", async () => {
    const bytes = await browserChunk();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = put(bytes.slice());
    const response = await call(request);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [reserve] = named("reserve_embryo_ingest_chunk_v1");
    expect(reserve.args).toMatchObject({ p_session_id: SESSION, p_sequence: 0, p_sha256: sha(bytes), p_byte_count: bytes.byteLength, p_record_count: 2 });
    const fragments = reserve.args.p_fragments as Fragment[];
    expect(fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1, 2]);
    expect(store.targets).toHaveBeenCalledExactlyOnceWith(SESSION, 0);
    expect(store.written.map((entry) => entry.target.ordinal)).toEqual([0, 1, 2]);
    for (const entry of store.written) {
      const fragment = fragments[entry.target.ordinal];
      expect(entry.target.receipt).toMatchObject({ sessionId: SESSION, sequence: 0, byteCount: fragment.bytes, sha256: fragment.sha256 });
      expect(sha(entry.copy)).toBe(fragment.sha256);
      expect(entry.copy.byteLength).toBe(fragment.bytes);
      expect(entry.signal).toBe(request.signal);
      const text = new TextDecoder().decode(entry.copy);
      for (const secret of [CHALLENGE, ...HANDLES, "SYNTHETIC_", "PRIVATE"]) expect(text).not.toContain(secret);
      // The route zero-fills its own buffers once the request is done.
      expect(entry.bytes.every((byte) => byte === 0)).toBe(true);
    }
    // The order docs/embryo-fragment-storage.md fixes: reserve, targets, writes, commit.
    expect(mocks.calls.map((entry) => entry.name).slice(-2)).toEqual(["reserve_embryo_ingest_chunk_v1", "commit_embryo_ingest_chunk_v1"]);
    expect(named("commit_embryo_ingest_chunk_v1").map((entry) => entry.args))
      .toEqual([{ p_session_id: SESSION, p_sequence: 0, p_sha256: sha(bytes) }]);
    expect(named("fail_embryo_ingest_attempt_v1")).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("resumes an identical retry: a stored receipt writes nothing and commits idempotently", async () => {
    mocks.results.reserve_embryo_ingest_chunk_v1 = { data: { status: "stored", objects: [] }, error: null };
    expect((await call(put(await browserChunk()))).status).toBe(204);
    expect(store.targets).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(named("commit_embryo_ingest_chunk_v1")).toHaveLength(1);
  });

  it("skips fragments that already landed on a resumed reservation", async () => {
    store = memoryStore({ states: { 1: "landed" } });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(204);
    expect(store.written.map((entry) => entry.target.ordinal)).toEqual([0, 2]);
  });

  it("re-reads the targets after a write that did not land, rewrites only what is still open, and commits", async () => {
    store = memoryStore({ outcomes: ["landed", "retry", "landed"] });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(204);
    expect(store.targets).toHaveBeenCalledTimes(2);
    expect(store.written.map((entry) => entry.target.ordinal)).toEqual([0, 1, 2, 1]);
    expect(named("commit_embryo_ingest_chunk_v1")).toHaveLength(1);
  });

  it("answers the retryable 503, and never commits, when a write still has not landed on the second pass", async () => {
    store = memoryStore({ outcomes: ["retry", "landed", "landed", "retry"] });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(503);
    expect(named("commit_embryo_ingest_chunk_v1")).toEqual([]);
    expect(named("fail_embryo_ingest_attempt_v1")).toEqual([]);
  });

  it("fails the attempt when a key holds other bytes, because that fragment can never land", async () => {
    store = memoryStore({ outcomes: ["conflict"] });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(store.written).toHaveLength(1);
    expect(named("fail_embryo_ingest_attempt_v1").map((entry) => entry.args.p_code)).toEqual(["chunk"]);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
    expect(named("commit_embryo_ingest_chunk_v1")).toEqual([]);
  });

  it("answers 503, not a terminal answer, when that failure cannot be recorded", async () => {
    store = memoryStore({ outcomes: ["conflict"] });
    mocks.store = store;
    mocks.results.fail_embryo_ingest_attempt_v1 = { data: null, error: { code: "55P03" } };
    expect((await call(put(await browserChunk()))).status).toBe(503);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("fails the attempt, writing nothing, when a receipt describes other bytes than the fragment it validated", async () => {
    store = memoryStore({ receipts: (receipt) => receipt.ordinal === 2 ? { ...receipt, sha256: "0".repeat(64) } : receipt });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(store.write).not.toHaveBeenCalled();
    expect(named("fail_embryo_ingest_attempt_v1").map((entry) => entry.args.p_code)).toEqual(["chunk"]);
    expect(named("commit_embryo_ingest_chunk_v1")).toEqual([]);
  });

  it.each([
    ["another session's receipt", { receipts: (receipt: Receipt) => ({ ...receipt, sessionId: crypto.randomUUID() }) }],
    ["another chunk's receipt", { receipts: (receipt: Receipt) => ({ ...receipt, sequence: 1 }) }],
    ["a Supabase receipt, which only tests may select", { receipts: (receipt: Receipt) => ({ ...receipt, backend: "supabase" as const }) }],
    ["an uncertain target", { states: { 0: "uncertain" as const } }],
    ["targets that are not one per embryo", { answer: { status: "reserved", targets: [] } }],
    ["a targets door that fails", { throwOnTargets: true }],
  ])("writes nothing and answers the retryable 503 for %s", async (_label, behaviour) => {
    store = memoryStore(behaviour);
    mocks.store = store;
    const response = await call(put(await browserChunk()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE");
    expect(store.write).not.toHaveBeenCalled();
    expect(named("commit_embryo_ingest_chunk_v1")).toEqual([]);
    expect(named("fail_embryo_ingest_attempt_v1")).toEqual([]);
  });

  it("dispatches the unwind when reading the targets fails the attempt", async () => {
    store = memoryStore({ answer: { status: "failure_pending" } });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("answers a session the targets door no longer serves with the opaque 404", async () => {
    store = memoryStore({ answer: { status: "denied" } });
    mocks.store = store;
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("dispatches the unwind when the reservation fails the attempt", async () => {
    mocks.results.reserve_embryo_ingest_chunk_v1 = { data: { status: "failure_pending" }, error: null };
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1").map((entry) => entry.args)).toEqual([{ p_cohort_id: COHORT, p_ingest_revision: 4 }]);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("answers the retryable 503 while no backend is selected, since the reservation rolled back", async () => {
    mocks.results.reserve_embryo_ingest_chunk_v1 = { data: null, error: { code: "55000" } };
    expect((await call(put(await browserChunk()))).status).toBe(503);
    expect(store.targets).not.toHaveBeenCalled();
  });

  it("answers a session that is no longer open with the opaque 404", async () => {
    mocks.results.reserve_embryo_ingest_chunk_v1 = { data: { status: "denied" }, error: null };
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toEqual([]);
  });

  it("dispatches the unwind when the commit fails the attempt, and retries a refused commit", async () => {
    mocks.results.commit_embryo_ingest_chunk_v1 = { data: { status: "failure_pending" }, error: null };
    expect((await call(put(await browserChunk()))).status).toBe(404);
    expect(named("prepare_embryo_ingest_unwind_v1")).toHaveLength(1);
    mocks.calls = [];
    store = memoryStore();
    mocks.store = store;
    // 55000 embryo_chunk_objects_unlanded: the commit gate found a fragment not landed.
    mocks.results.commit_embryo_ingest_chunk_v1 = { data: null, error: { code: "55000" } };
    expect((await call(put(await browserChunk()))).status).toBe(503);
  });

  it("refuses a reservation answer it cannot read", async () => {
    mocks.results.reserve_embryo_ingest_chunk_v1 = { data: { status: "reserved", objects: [], extra: 1 }, error: null };
    expect((await call(put(await browserChunk()))).status).toBe(503);
    expect(store.write).not.toHaveBeenCalled();
  });
});
