import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbryoFixtureSigner, createEmbryoFragmentGateway, EMBRYO_FIXTURE_BUCKET, EMBRYO_FIXTURE_ORIGIN,
  EMBRYO_FIXTURE_SUPABASE_URL,
} from "../../../scripts/ci-browser/embryo-fragment-fixture";
import { EmbryoFragmentStorageError, type EmbryoFragmentRpc, type EmbryoR2WriteTarget,
  type EmbryoStoredFragment } from "./fragment-storage";
import { r2EmbryoCanonicalPartWriter, r2EmbryoFragmentReader } from "./split-fragment-reader";
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

describe("R2 canonical-part writer for the split worker", () => {
  // The undeployed gateway over an in-memory binding, as fragment-storage.test.ts runs it.
  let gateway: ReturnType<typeof createEmbryoFragmentGateway>;
  let methods: string[];
  beforeEach(() => {
    const signer = createEmbryoFixtureSigner();
    gateway = createEmbryoFragmentGateway(signer.publicJwk);
    methods = [];
    vi.stubEnv("INHERIT_UPLOAD_SIGNING_JWK", JSON.stringify(signer.privateJwk));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", EMBRYO_FIXTURE_SUPABASE_URL);
    vi.stubEnv("INHERIT_EMBRYO_R2_ORIGIN", EMBRYO_FIXTURE_ORIGIN);
    vi.stubEnv("INHERIT_EMBRYO_R2_BUCKET", EMBRYO_FIXTURE_BUCKET);
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== EMBRYO_FIXTURE_ORIGIN) throw new Error("unexpected origin");
      methods.push(request.method);
      return gateway.fetch(request);
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const bytes = new TextEncoder().encode("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\n1\t12345\t.\tA\tG\n");
  const target = (): EmbryoR2WriteTarget => ({ version: "embryo-ingest-write-target-v1", sessionId: randomUUID(),
    sequence: 1, ordinal: 2, backend: "r2", bucket: EMBRYO_FIXTURE_BUCKET, objectKey: `embryo/${randomUUID()}`,
    byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    writeExpiresAt: new Date(Date.now() + 50_000).toISOString() });

  it("writes create-only, reads back, and lands through the worker's ACK carrier only", async () => {
    const t = target();
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const acknowledge: EmbryoFragmentRpc = (name, args) => ({ abortSignal: async () => {
      calls.push({ name, args });
      return { data: { receipt: args.p_expected, providerVersion: args.p_provider_version, etag: args.p_etag }, error: null };
    } });
    const stored = await r2EmbryoCanonicalPartWriter()({ target: t, bytes, acknowledge }, new AbortController().signal);
    const object = gateway.values.get(t.objectKey)!;
    expect(stored).toEqual({ receipt: t, providerVersion: object.version, etag: object.etag });
    expect(methods).toEqual(["PUT", "GET"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_expected: t, p_observed_byte_count: bytes.length, p_observed_sha256: t.sha256 });
  });

  it("does not land bytes that differ from the receipt", async () => {
    const acknowledge = vi.fn();
    const wrong = bytes.slice(); wrong[wrong.length - 2] = 67;
    await expect(r2EmbryoCanonicalPartWriter()({ target: target(), bytes: wrong, acknowledge },
      new AbortController().signal)).rejects.toMatchObject({ code: "invalid_request" });
    expect(methods).toEqual([]);
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
