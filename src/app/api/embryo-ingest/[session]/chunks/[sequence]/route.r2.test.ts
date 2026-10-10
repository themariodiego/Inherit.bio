import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The chunk route through the real R2 fragment writer (`writeEmbryoFragment`)
 * and the real `workers/embryo-fragments` gateway over the in-memory R2
 * binding from `scripts/ci-browser/embryo-fragment-fixture.ts`. Only the
 * database is simulated:
 * a small in-memory model of the reservation, the write targets (with window
 * renewal), the landing ACK and the commit gate, as
 * docs/embryo-fragment-storage.md describes them. No provider, network or
 * hosted database is involved. Every SYNTHETIC or PRIVATE label is invented.
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

type Intent = {
  ordinal: number; objectKey: string; byteCount: number; sha256: string; writeExpiresAt: string;
  state: "open" | "landed"; providerVersion?: string; etag?: string;
};
const db = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  chunkSha: null as string | null,
  chunkState: "reserved" as "reserved" | "stored",
  intents: [] as Intent[],
  keys: [] as string[],
  bucket: "",
  failAck: new Set<number>(),
  expireOnReserve: false,
}));

vi.mock("@/lib/account-deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account-deletion")>()),
  getSensitiveAccountContext: async () => ({ user: { id: ACCOUNT }, sessionId: AUTH_SESSION }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      const promise = Promise.resolve().then(() => sql(name, args));
      return Object.assign(promise, { abortSignal: () => promise });
    },
    from: () => ({ select: () => ({ in: async (_column: string, ids: string[]) => ({
      data: ids.map((id) => ({ id, jurisdiction_code: "GB" })), error: null,
    }) }) }),
  }),
}));

function receiptOf(intent: Intent) {
  return {
    version: "embryo-ingest-write-target-v1", sessionId: SESSION, sequence: 0, ordinal: intent.ordinal,
    backend: "r2", bucket: db.bucket, objectKey: intent.objectKey, byteCount: intent.byteCount,
    sha256: intent.sha256, writeExpiresAt: intent.writeExpiresAt,
  };
}

/** The SQL contract, in memory. */
function sql(name: string, args: Record<string, unknown>): { data: unknown; error: { code: string; message?: string } | null } {
  db.calls.push({ name, args });
  switch (name) {
    case "authorize_embryo_ingest_request_v1":
      return { data: {
        status: "authorized", session: SESSION, cohortId: COHORT, uploadId: "12345678-1234-4234-8234-0000000000d1",
        ingestRevision: 4, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), challengeHash: sha(CHALLENGE),
        transportRevision: REVISION, build: "GRCh38", format: "vcf", sampleCount: 3,
        handles: HANDLES.map((handle, ordinal) => ({ ordinal, hash: sha(handle) })),
      }, error: null };
    case "reserve_embryo_ingest_chunk_v1": {
      if (db.chunkSha !== null) {
        // An identical retry resumes the same objects; a changed hash would fail the attempt.
        if (db.chunkSha !== args.p_sha256) return { data: { status: "failure_pending" }, error: null };
        return { data: { status: db.chunkState, objects: [] }, error: null };
      }
      db.chunkSha = args.p_sha256 as string;
      db.intents = (args.p_fragments as { ordinal: number; bytes: number; sha256: string }[]).map((fragment) => ({
        ordinal: fragment.ordinal, objectKey: db.keys[fragment.ordinal], byteCount: fragment.bytes,
        sha256: fragment.sha256, state: "open",
        writeExpiresAt: new Date(Date.now() + (db.expireOnReserve ? -1_000 : 60_000)).toISOString(),
      }));
      return { data: { status: "reserved", objects: db.intents.map((intent) => ({ ordinal: intent.ordinal, objectId: crypto.randomUUID() })) }, error: null };
    }
    case "embryo_ingest_write_targets_v1":
      // Reading the targets renews an expired open window.
      for (const intent of db.intents) {
        if (intent.state === "open" && Date.parse(intent.writeExpiresAt) <= Date.now()) {
          intent.writeExpiresAt = new Date(Date.now() + 60_000).toISOString();
        }
      }
      return { data: { status: db.chunkState, targets: db.intents.map((intent) => ({
        receipt: receiptOf(intent), state: intent.state,
        stored: intent.state === "landed" ? { providerVersion: intent.providerVersion, etag: intent.etag } : null,
      })) }, error: null };
    case "ack_embryo_ingest_r2_write_v1": {
      const intent = db.intents.find((candidate) => candidate.ordinal === args.p_ordinal);
      if (!intent || !isDeepStrictEqual(args.p_expected, receiptOf(intent)) || args.p_observed_sha256 !== intent.sha256
        || args.p_observed_byte_count !== intent.byteCount || Date.parse(intent.writeExpiresAt) <= Date.now()) {
        return { data: null, error: { code: "42501", message: "embryo_object_unavailable" } };
      }
      if (db.failAck.delete(intent.ordinal)) return { data: null, error: { code: "55P03" } };
      if (intent.state === "landed" && (intent.providerVersion !== args.p_provider_version || intent.etag !== args.p_etag)) {
        return { data: null, error: { code: "42501", message: "embryo_object_unavailable" } };
      }
      Object.assign(intent, { state: "landed", providerVersion: args.p_provider_version, etag: args.p_etag });
      return { data: { receipt: receiptOf(intent), providerVersion: intent.providerVersion, etag: intent.etag }, error: null };
    }
    case "commit_embryo_ingest_chunk_v1":
      if (db.intents.some((intent) => intent.state !== "landed")) {
        return { data: null, error: { code: "55000", message: "embryo_chunk_objects_unlanded" } };
      }
      db.chunkState = "stored";
      return { data: { status: "stored" }, error: null };
    case "fail_embryo_ingest_attempt_v1":
      return { data: { status: "failure_pending", cohortId: COHORT, ingestRevision: 4 }, error: null };
    case "prepare_embryo_ingest_unwind_v1":
      return { data: { status: "storage_pending" }, error: null };
    default:
      throw new Error(`unexpected rpc ${name}`);
  }
}

const {
  createEmbryoFixtureSigner, createEmbryoFragmentGateway, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ORIGIN,
  EMBRYO_FIXTURE_SUPABASE_URL,
} = await import("../../../../../../../scripts/ci-browser/embryo-fragment-fixture");
const signer = createEmbryoFixtureSigner();
vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(signer.privateJwk));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", EMBRYO_FIXTURE_SUPABASE_URL);
vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN);
vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const { PUT } = await import("./route");
const { embryoVcfChunks } = await import("@/lib/embryos/vcf-transport");

const SOURCE = [
  "##fileformat=VCFv4.2", "##reference=GRCh38", "##SAMPLE=<ID=PRIVATE_SAMPLE>",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_A\tSYNTHETIC_B\tSYNTHETIC_C",
  "chr1\t1000\trs1\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:10\t1/1:12\t0/0:9",
  "chr2\t2000\t.\tC\tT\t.\tPASS\tPRIVATE_NOTE=1\tGT\t0/0\t0/1\t./.", "",
].join("\n");

async function browserChunk() {
  const [chunk] = await Array.fromAsync(embryoVcfChunks(new Blob([SOURCE]), {
    challenge: CHALLENGE, revision: REVISION, build: "GRCh38", sampleCount: 3, handles: HANDLES,
  }));
  return chunk;
}

function put(bytes: Uint8Array) {
  return PUT(new Request(`${ORIGIN}/api/embryo-ingest/${SESSION}/chunks/0`, {
    method: "PUT",
    headers: {
      origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength), cookie: `inherit-ingest-${SESSION}=${COOKIE_VALUE}`,
    },
    body: new Blob([bytes.slice() as Uint8Array<ArrayBuffer>]),
  }), { params: Promise.resolve({ session: SESSION, sequence: "0" }) });
}

let gateway: ReturnType<typeof createEmbryoFragmentGateway>;
let provider: { method: string; outage: boolean }[];
let outage: (request: Request) => boolean;
beforeEach(() => {
  gateway = createEmbryoFragmentGateway(signer.publicJwk);
  provider = [];
  outage = () => false;
  Object.assign(db, { calls: [], chunkSha: null, chunkState: "reserved", intents: [], failAck: new Set<number>(),
    expireOnReserve: false,
    keys: [0, 1, 2].map(() => `embryo/${crypto.randomUUID()}`), bucket: EMBRYO_FIXTURE_BUCKET });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== EMBRYO_FIXTURE_ORIGIN) throw new Error("unexpected origin");
    const down = outage(request);
    provider.push({ method: request.method, outage: down });
    if (down) throw new TypeError("synthetic network failure");
    return gateway.fetch(request);
  }));
});

const names = () => db.calls.map((call) => call.name);

describe("the chunk route on R2", () => {
  it("reserves, reads the targets, lands every fragment create-only at its receipt, then commits", async () => {
    const bytes = await browserChunk();
    const response = await put(bytes);
    expect(response.status).toBe(204);
    expect(names()).toEqual([
      "authorize_embryo_ingest_request_v1", "reserve_embryo_ingest_chunk_v1", "embryo_ingest_write_targets_v1",
      "ack_embryo_ingest_r2_write_v1", "ack_embryo_ingest_r2_write_v1", "ack_embryo_ingest_r2_write_v1",
      "commit_embryo_ingest_chunk_v1",
    ]);
    // Each write is a create-only PUT and an exact-version read to EOF.
    expect(provider.map((entry) => entry.method)).toEqual(["PUT", "GET", "PUT", "GET", "PUT", "GET"]);
    for (const intent of db.intents) {
      const stored = gateway.values.get(intent.objectKey)!;
      expect(sha(stored.bytes)).toBe(intent.sha256);
      expect(stored.bytes.byteLength).toBe(intent.byteCount);
      const text = new TextDecoder().decode(stored.bytes);
      for (const secret of [CHALLENGE, ...HANDLES, "SYNTHETIC_", "PRIVATE"]) expect(text).not.toContain(secret);
      expect(intent).toMatchObject({ state: "landed", providerVersion: stored.version, etag: stored.etag });
    }
    expect([...gateway.values.keys()].sort()).toEqual([...db.keys].sort());
  });

  it("resumes an ACK lost after the write: the second pass finds the same bytes at the key and lands them", async () => {
    db.failAck.add(1);
    const response = await put(await browserChunk());
    expect(response.status).toBe(204);
    expect(names().filter((name) => name === "embryo_ingest_write_targets_v1")).toHaveLength(2);
    // Ordinal 1 is written twice; the gateway reports the version already there.
    expect(names().filter((name) => name === "ack_embryo_ingest_r2_write_v1")).toHaveLength(4);
    expect(gateway.values.size).toBe(3);
  });

  it("writes with the receipt the targets door renewed, never one from an expired window", async () => {
    db.expireOnReserve = true;
    const response = await put(await browserChunk());
    expect(response.status).toBe(204);
    const acks = db.calls.filter((call) => call.name === "ack_embryo_ingest_r2_write_v1");
    expect(acks).toHaveLength(3);
    for (const ack of acks) {
      const expected = ack.args.p_expected as { writeExpiresAt: string };
      expect(Date.parse(expected.writeExpiresAt)).toBeGreaterThan(Date.now());
    }
  });

  it("answers the retryable 503 when the provider is unreachable, and the identical retry resumes the same keys", async () => {
    const bytes = await browserChunk();
    outage = () => true;
    const first = await put(bytes);
    expect(first.status).toBe(503);
    expect(names()).not.toContain("commit_embryo_ingest_chunk_v1");
    expect(names()).not.toContain("fail_embryo_ingest_attempt_v1");
    expect(gateway.values.size).toBe(0);
    const keys = db.intents.map((intent) => intent.objectKey);
    outage = () => false;
    const second = await put(bytes);
    expect(second.status).toBe(204);
    expect(db.intents.map((intent) => intent.objectKey)).toEqual(keys);
    expect([...gateway.values.keys()].sort()).toEqual([...keys].sort());
  });

  it("fails the attempt when a key already holds other bytes, and never commits", async () => {
    await gateway.binding.put(db.keys[0], new TextEncoder().encode("PRIVATE other bytes\n"));
    const response = await put(await browserChunk());
    expect(response.status).toBe(404);
    expect(names()).toContain("fail_embryo_ingest_attempt_v1");
    expect(db.calls.find((call) => call.name === "fail_embryo_ingest_attempt_v1")!.args.p_code).toBe("chunk");
    expect(names()).toContain("prepare_embryo_ingest_unwind_v1");
    expect(names()).not.toContain("commit_embryo_ingest_chunk_v1");
    expect(new TextDecoder().decode(gateway.values.get(db.keys[0])!.bytes)).toBe("PRIVATE other bytes\n");
  });

  it("writes nothing to a bucket this deployment is not configured for", async () => {
    db.bucket = "inherit-embryo-other";
    const response = await put(await browserChunk());
    expect(response.status).toBe(503);
    expect(provider).toEqual([]);
    expect(names()).not.toContain("commit_embryo_ingest_chunk_v1");
  });

  /**
   * `embryoFragmentStorageConfigured()` gates the route before it authorizes,
   * reads or reserves anything, so an unconfigured deployment never reserves
   * a fragment it cannot write. Planted regression: without that gate the
   * route reserves first and only then fails to write.
   */
  it.each([
    ["no gateway origin", { INHERIT_EMBRYO_R2_ORIGIN: undefined }],
    ["a plain-http origin", { INHERIT_EMBRYO_R2_ORIGIN: "http://embryo.fragments.test" }],
    ["an origin with a path", { INHERIT_EMBRYO_R2_ORIGIN: `${EMBRYO_FIXTURE_ORIGIN}/fragments` }],
    ["a bucket outside the embryo namespace", { INHERIT_EMBRYO_R2_BUCKET: "genomes" }],
  ])("refuses with the closed 503 and reserves nothing with %s", async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    try {
      const response = await put(await browserChunk());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "unavailable" });
      expect(db.calls).toEqual([]);
      expect(provider).toEqual([]);
    } finally {
      vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN);
      vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
    }
  });
});
