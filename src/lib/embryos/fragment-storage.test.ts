import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbryoFixtureSigner, createEmbryoFragmentGateway, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ORIGIN,
  EMBRYO_FIXTURE_SUPABASE_URL,
} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import {
  EmbryoFragmentStorageError, parseEmbryoWriteTargets, readEmbryoFragment, writeEmbryoFragment,
  type EmbryoFragmentRpc, type EmbryoR2WriteTarget, type EmbryoStoredFragment,
} from "./fragment-storage";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new TextEncoder().encode("#CHROM\tPOS\tID\tREF\tALT\n1\t12345\t.\tA\tG\n");

let gateway: ReturnType<typeof createEmbryoFragmentGateway>;
let requests: Array<{ method: string; url: string }>;
beforeEach(() => {
  const signer = createEmbryoFixtureSigner();
  gateway = createEmbryoFragmentGateway(signer.publicJwk);
  requests = [];
  vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(signer.privateJwk));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", EMBRYO_FIXTURE_SUPABASE_URL);
  vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN);
  vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== EMBRYO_FIXTURE_ORIGIN) throw new Error("unexpected origin");
    requests.push({ method: request.method, url: request.url });
    return gateway.fetch(request);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function target(overrides: Partial<EmbryoR2WriteTarget> = {}): EmbryoR2WriteTarget {
  return { version: "embryo-ingest-write-target-v1", sessionId: randomUUID(), sequence: 3, ordinal: 1,
    backend: "r2", bucket: EMBRYO_FIXTURE_BUCKET, objectKey: `embryo/${randomUUID()}`,
    byteCount: bytes.length, sha256: sha(bytes), writeExpiresAt: new Date(Date.now() + 50_000).toISOString(),
    ...overrides };
}
/** SQL's side of the ACK: answers with the receipt and the identity it was given. */
function rpc(answer?: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fn: EmbryoFragmentRpc = (name, args) => ({
    abortSignal: () => {
      calls.push({ name, args });
      return Promise.resolve(answer ? answer(args) : { data: { receipt: args.p_expected,
        providerVersion: args.p_provider_version, etag: args.p_etag }, error: null });
    },
  });
  return { fn, calls };
}
const code = async (promise: Promise<unknown>) => {
  try { await promise; return "resolved"; } catch (error) {
    return error instanceof EmbryoFragmentStorageError ? error.code : "other";
  }
};

describe("writeEmbryoFragment", () => {
  it("writes create-only, reads the exact version back, then lands it with the observed identity", async () => {
    const t = target(), sql = rpc();
    const stored = await writeEmbryoFragment({ rpc: sql.fn, target: t, bytes, signal: new AbortController().signal });
    const object = gateway.values.get(t.objectKey)!;
    expect(stored).toEqual({ receipt: t, providerVersion: object.version, etag: object.etag });
    expect(requests.map(r => r.method)).toEqual(["PUT", "GET"]);
    expect(sql.calls).toEqual([{ name: "ack_embryo_ingest_r2_write_v1", args: {
      p_session_id: t.sessionId, p_sequence: 3, p_ordinal: 1, p_expected: t,
      p_provider_version: object.version, p_etag: object.etag, p_observed_sha256: sha(bytes),
      p_observed_byte_count: bytes.length } }]);
  });

  it("resumes after a lost write response instead of failing the fragment", async () => {
    const t = target();
    await writeEmbryoFragment({ rpc: rpc().fn, target: t, bytes, signal: new AbortController().signal });
    const version = gateway.values.get(t.objectKey)!.version;
    const sql = rpc();
    const again = await writeEmbryoFragment({ rpc: sql.fn, target: t, bytes, signal: new AbortController().signal });
    expect(again.providerVersion).toBe(version);
    expect(sql.calls).toHaveLength(1);
  });

  it.each([
    ["a Supabase target", () => ({ ...target(), backend: "supabase", bucket: "genomes",
      objectKey: `${randomUUID()}/${randomUUID()}/${randomUUID()}/${randomUUID()}.vcf` })],
    ["bytes of another size", () => target({ byteCount: bytes.length + 1 })],
    ["bytes of another hash", () => target({ sha256: "0".repeat(64) })],
    ["a receipt with an extra field", () => ({ ...target(), accountId: randomUUID() })],
    ["a prepared-object key", () => target({ objectKey: `prepared/${randomUUID()}` })],
  ])("refuses %s before any provider or database call", async (_label, make) => {
    const sql = rpc();
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: make() as EmbryoR2WriteTarget, bytes,
      signal: new AbortController().signal }))).toBe("invalid_request");
    expect(requests).toHaveLength(0); expect(sql.calls).toHaveLength(0);
  });

  it("refuses a closed window and an unconfigured bucket without writing", async () => {
    const sql = rpc();
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: target({ writeExpiresAt: new Date(Date.now() - 1).toISOString() }),
      bytes, signal: new AbortController().signal }))).toBe("unavailable");
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: target({ bucket: "inherit-embryo-elsewhere" }),
      bytes, signal: new AbortController().signal }))).toBe("unavailable");
    vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", "http://embryo.fragments.test");
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: target(), bytes,
      signal: new AbortController().signal }))).toBe("unavailable");
    expect(requests).toHaveLength(0); expect(sql.calls).toHaveLength(0);
  });

  it("does not land a key that holds anything else", async () => {
    const t = target(), sql = rpc();
    await gateway.binding.put(t.objectKey, new Uint8Array(), { customMetadata: { state: "tombstone" } });
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: t, bytes, signal: new AbortController().signal })))
      .toBe("conflict");
    expect(sql.calls).toHaveLength(0);
  });

  it("does not land an object whose read-back differs", async () => {
    const t = target(), sql = rpc();
    const get = gateway.binding.get;
    gateway.binding.get = async (key: string) => {
      const view = await get(key);
      return view && { ...view, body: new Response(new Uint8Array(bytes.length)).body! };
    };
    expect(await code(writeEmbryoFragment({ rpc: sql.fn, target: t, bytes, signal: new AbortController().signal })))
      .toBe("integrity_mismatch");
    expect(sql.calls).toHaveLength(0);
  });

  it("treats a refused or mismatched ACK as not landed", async () => {
    expect(await code(writeEmbryoFragment({ rpc: rpc(() => ({ data: null, error: { code: "42501" } })).fn,
      target: target(), bytes, signal: new AbortController().signal }))).toBe("unavailable");
    expect(await code(writeEmbryoFragment({ rpc: rpc(args => ({ data: { receipt: args.p_expected,
      providerVersion: "0".repeat(32), etag: args.p_etag }, error: null })).fn,
      target: target(), bytes, signal: new AbortController().signal }))).toBe("integrity_mismatch");
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await code(writeEmbryoFragment({ rpc: rpc().fn, target: target(), bytes, signal: controller.signal })))
      .toBe("aborted");
  });
});

describe("readEmbryoFragment", () => {
  it("returns the exact bytes of the landed version and nothing after a marker", async () => {
    const t = target();
    const stored = await writeEmbryoFragment({ rpc: rpc().fn, target: t, bytes, signal: new AbortController().signal });
    expect(await readEmbryoFragment({ stored, signal: new AbortController().signal })).toEqual(bytes);
    await gateway.binding.put(t.objectKey, new Uint8Array(), { customMetadata: { state: "tombstone" } });
    expect(await code(readEmbryoFragment({ stored, signal: new AbortController().signal }))).toBe("integrity_mismatch");
  });

  it("refuses a stored identity outside the contract", async () => {
    const stored = { receipt: target(), providerVersion: "not-a-version", etag: "0".repeat(32) } as EmbryoStoredFragment;
    expect(await code(readEmbryoFragment({ stored, signal: new AbortController().signal }))).toBe("invalid_request");
    expect(requests).toHaveLength(0);
  });
});

describe("parseEmbryoWriteTargets", () => {
  it("accepts the door's answers and refuses inconsistent ones", () => {
    const t = target();
    expect(parseEmbryoWriteTargets({ status: "reserved", targets: [{ receipt: t, state: "open", stored: null }] }).status)
      .toBe("reserved");
    expect(parseEmbryoWriteTargets({ status: "failure_pending" })).toEqual({ status: "failure_pending" });
    for (const bad of [
      { status: "reserved", targets: [{ receipt: t, state: "landed", stored: null }] },
      { status: "reserved", targets: [{ receipt: t, state: "open", stored: { providerVersion: "1".repeat(32), etag: "2".repeat(32) } }] },
      { status: "reserved", targets: [{ receipt: t, state: "landed", stored: { storageObjectId: randomUUID(), storageVersion: randomUUID() } }] },
      { status: "denied", targets: [] },
    ]) expect(() => parseEmbryoWriteTargets(bad)).toThrow(EmbryoFragmentStorageError);
  });
});
