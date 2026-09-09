import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreparedArtifactWriter, type PreparedArtifactDescriptor, type PreparedArtifactReceipt } from "./storage-writer";

const origin = "https://synthetic.invalid", credential = "synthetic-placeholder";
const claim = { jobId: "11111111-1111-4111-8111-111111111111", attemptId: "22222222-2222-4222-8222-222222222222", claimTokenHash: "a".repeat(64) };
const storageObjectId = "55555555-5555-4555-8555-555555555555";
type Phase = "reserve" | "upload" | "check" | "get" | "ack";
type Override = (phase: Phase, init: RequestInit) => Response | Promise<Response> | undefined;
function phaseOf(url: string): Phase {
  if (url.includes("reserve_own_preparation_artifact_v1")) return "reserve";
  if (url.includes("check_own_preparation_claim_v1")) return "check";
  if (url.includes("ack_own_preparation_artifact_v1")) return "ack";
  if (url.includes("/object/authenticated/")) return "get";
  if (url.includes("/object/genomes/")) return "upload";
  throw new Error("Unexpected mock request");
}
function fixture(override?: Override) {
  const bytes = new TextEncoder().encode("only synthetic prepared container bytes");
  const descriptor: PreparedArtifactDescriptor = { kind: "container", sequence: 7, byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  const receipt: PreparedArtifactReceipt = { version: "own-preparation-artifact-v1",
    artifactId: "33333333-3333-4333-8333-333333333333", jobId: claim.jobId, attemptId: claim.attemptId,
    sequence: descriptor.sequence, bucket: "genomes", objectKey: "prepared/44444444-4444-4444-8444-444444444444",
    byteCount: bytes.length, sha256: descriptor.sha256, writeExpiresAt: new Date(Date.now() + 20_000).toISOString() };
  const stored = { id: storageObjectId };
  const order: string[] = [];
  const provider = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith(origin)).toBe(true);
    const phase = phaseOf(url); order.push(phase);
    const replacement = override?.(phase, init);
    if (replacement !== undefined) return replacement;
    if (phase === "reserve" || phase === "ack") return Response.json(receipt);
    if (phase === "upload") return Response.json({ Id: stored.id, Key: `genomes/${receipt.objectKey}` });
    if (phase === "check") return Response.json({ version: "own-preparation-claim-v1", jobId: claim.jobId, attemptId: claim.attemptId });
    return new Response(bytes, { headers: { "content-length": String(bytes.length), "content-encoding": "identity" } });
  });
  vi.stubGlobal("fetch", provider);
  return { bytes, descriptor, receipt, stored, provider, order, writer: createPreparedArtifactWriter(claim),
    input: { descriptor, bytes } };
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", credential);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("prepared artifact write protocol (mock provider, not durability proof)", () => {
  it("reserves, creates only, checks live claim, verifies full GET EOF, then ACKs exact identity", async () => {
    let part = 0;
    const f = fixture(phase => phase === "get" ? new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (part++ === 0) controller.enqueue(f.bytes.subarray(0, 3));
      else if (part === 2) controller.enqueue(f.bytes.subarray(3));
      else { f.order.push("eof"); controller.close(); }
    } }, { highWaterMark: 0 })) : undefined);
    expect(await f.writer(f.input)).toEqual({ receipt: f.receipt, storageObjectId });
    expect(f.order).toEqual(["reserve", "upload", "check", "get", "eof", "ack"]);
    const args = { p_job_id: claim.jobId, p_attempt_id: claim.attemptId, p_claim_token_hash: claim.claimTokenHash };
    expect(JSON.parse(f.provider.mock.calls[0][1].body as string)).toEqual({ ...args, p_descriptor: f.descriptor });
    expect(f.provider.mock.calls[1]).toEqual([`${origin}/storage/v1/object/genomes/${f.receipt.objectKey}`, expect.objectContaining({
      method: "POST", body: f.bytes, headers: { Authorization: `Bearer ${credential}`, apikey: credential,
        "Content-Type": "application/octet-stream", "Content-Length": String(f.bytes.length), "Cache-Control": "max-age=0", "x-upsert": "false" },
    })]);
    expect(JSON.parse(f.provider.mock.calls[2][1].body as string)).toEqual(args);
    expect(f.provider.mock.calls[3]).toEqual([`${origin}/storage/v1/object/authenticated/genomes/${f.receipt.objectKey}`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${credential}`, apikey: credential, "Accept-Encoding": "identity" } })]);
    expect(JSON.parse(f.provider.mock.calls[4][1].body as string)).toEqual({ ...args, p_artifact_id: f.receipt.artifactId,
      p_storage_object_id: storageObjectId, p_expected_receipt: f.receipt, p_observed_sha256: f.descriptor.sha256 });
    for (const [, init] of f.provider.mock.calls) expect(init).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) });
  });
  it("owns descriptor and bytes before the first awaited reservation", async () => {
    const gate = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>();
    const f = fixture(phase => { if (phase === "reserve") { entered.resolve(); return gate.promise; } });
    const original = Uint8Array.from(f.bytes), originalDescriptor = { ...f.descriptor };
    // GET must reflect the mock uploaded object, not the caller's mutable input.
    f.provider.mockImplementationOnce(async () => { f.order.push("reserve"); entered.resolve(); return gate.promise; });
    const result = f.writer(f.input); await entered.promise;
    f.bytes.fill(0); f.descriptor.sha256 = "0".repeat(64); f.descriptor.sequence++;
    gate.resolve(Response.json(f.receipt));
    // Override subsequent default GET bytes only; everything else still follows
    // the production protocol mock and exact original registered identity.
    f.provider.mockImplementationOnce(async (url, init) => {
      f.order.push("upload"); expect(phaseOf(url)).toBe("upload"); expect(init.body).toEqual(original);
      return Response.json({ Id: storageObjectId, Key: `genomes/${f.receipt.objectKey}` });
    }).mockImplementationOnce(async () => Response.json({ version: "own-preparation-claim-v1", jobId: claim.jobId, attemptId: claim.attemptId }))
      .mockImplementationOnce(async () => new Response(original));
    expect((await result).receipt.sha256).toBe(originalDescriptor.sha256);
  });
  it.each(["empty", "size", "hash", "kind", "sequence", "extra"])("refuses invalid %s input before reserve", async mode => {
    const f = fixture();
    if (mode === "empty") f.input.bytes = new Uint8Array();
    if (mode === "size") f.descriptor.byteCount++;
    if (mode === "hash") f.descriptor.sha256 = "0".repeat(64);
    if (mode === "kind") Object.assign(f.descriptor, { kind: "arbitrary" });
    if (mode === "sequence") f.descriptor.sequence = 4096;
    if (mode === "extra") Object.assign(f.descriptor, { url: "https://untrusted.invalid" });
    await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_request", message: "invalid_request" });
    expect(f.provider).not.toHaveBeenCalled();
  });
  it.each(["null", "path", "version", "job", "attempt", "size", "hash", "sequence", "expired", "extra"])(
    "refuses malformed %s reservation without POSTing bytes", async mode => {
      const f = fixture(phase => phase === "reserve" ? Response.json(mode === "null" ? null : changed) : undefined);
      const changed = { ...f.receipt };
      if (mode === "path") changed.objectKey = "../original";
      if (mode === "version") Object.assign(changed, { version: "future" });
      if (mode === "job") changed.jobId = storageObjectId;
      if (mode === "attempt") changed.attemptId = storageObjectId;
      if (mode === "size") changed.byteCount++;
      if (mode === "hash") changed.sha256 = "f".repeat(64);
      if (mode === "sequence") changed.sequence++;
      if (mode === "expired") changed.writeExpiresAt = new Date(Date.now() - 1).toISOString();
      if (mode === "extra") Object.assign(changed, { uploadUrl: "https://untrusted.invalid" });
      await expect(f.writer(f.input)).rejects.toBeDefined(); expect(f.order).toEqual(["reserve"]);
      await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_state" }); expect(f.provider).toHaveBeenCalledTimes(1);
    });
  it.each(["upload", "check", "ack"] as const)("refuses mismatched %s JSON and performs no later step", async phase => {
    const f = fixture(p => p !== phase ? undefined : Response.json(phase === "upload"
      ? { Id: storageObjectId, Key: "genomes/prepared/99999999-9999-4999-8999-999999999999" }
      : phase === "check" ? { version: "own-preparation-claim-v1", jobId: claim.jobId, attemptId: storageObjectId }
        : { ...f.receipt, artifactId: storageObjectId }));
    await expect(f.writer(f.input)).rejects.toBeDefined(); expect(f.order.at(-1)).toBe(phase);
  });
  it.each(["reserve", "upload", "check", "get", "ack"] as const)("cancels failed %s HTTP responses and sanitizes errors", async phase => {
    const cancel = vi.fn();
    const f = fixture(p => p === phase ? new Response(new ReadableStream({ cancel }), { status: 503 }) : undefined);
    const error = await f.writer(f.input).catch(error => error);
    expect(error).toMatchObject({ code: "unavailable", message: "unavailable" }); expect(cancel).toHaveBeenCalledOnce();
    expect(f.order.at(-1)).toBe(phase); expect(JSON.stringify(error)).not.toContain(credential);
  });
  it.each(["invalid-json", "invalid-utf8", "oversize-json"])("refuses %s registration body with no upload", async mode => {
    const f = fixture(phase => phase === "reserve" ? new Response(mode === "invalid-json" ? `secret ${credential}`
      : mode === "invalid-utf8" ? new Uint8Array([0xff]) : "x".repeat(16_385)) : undefined);
    const error = await f.writer(f.input).catch(error => error);
    expect(["unavailable", "integrity_mismatch"]).toContain(error.code); expect(error.message).toBe(error.code);
    expect(String(error)).not.toContain(credential); expect(f.order).toEqual(["reserve"]);
  });
  it.each(["short", "long", "wrong-hash", "partial", "range-header", "length", "encoding", "late-error"])(
    "refuses %s GET data without an ACK", async mode => {
      const f = fixture(phase => {
        if (phase !== "get") return undefined;
        let bytes = Uint8Array.from(f.bytes); const headers: Record<string, string> = {}; let status = 200;
        if (mode === "short") bytes = bytes.subarray(1);
        if (mode === "long") bytes = new Uint8Array(bytes.length + 1);
        if (mode === "wrong-hash") bytes[0] ^= 1;
        if (mode === "partial") status = 206;
        if (mode === "range-header") headers["content-range"] = `bytes 0-${bytes.length - 1}/${bytes.length}`;
        if (mode === "length") headers["content-length"] = "999";
        if (mode === "encoding") headers["content-encoding"] = "gzip";
        let sent = false;
        return mode === "late-error" ? new Response(new ReadableStream({ pull(controller) {
          if (!sent) { sent = true; controller.enqueue(bytes); } else controller.error(new Error(`late secret ${credential}`));
        } }, { highWaterMark: 0 })) : new Response(bytes, { status, headers });
      });
      const error = await f.writer(f.input).catch(error => error);
      expect(error.message).toBe(mode === "late-error" ? "unavailable" : "integrity_mismatch");
      expect(f.order).toEqual(["reserve", "upload", "check", "get"]);
    });
  it("waits for full GET EOF before acknowledging", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const entered = Promise.withResolvers<void>();
    const f = fixture(phase => phase === "get" ? new Response(new ReadableStream<Uint8Array>({ start(value) {
      controller = value; controller.enqueue(f.bytes); entered.resolve();
    } })) : undefined);
    const result = f.writer(f.input); await entered.promise;
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.order).not.toContain("ack");
    controller.close(); expect(Reflect.get(await result, "storageObjectId")).toBe(storageObjectId);
  });
  it("rejects concurrent calls without cancelling the active valid operation; permits the next serial write", async () => {
    const gate = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>();
    const f = fixture(phase => { if (phase === "reserve" && f.order.length === 1) { entered.resolve(); return gate.promise; } });
    const first = f.writer(f.input); await entered.promise;
    await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_state" }); expect(f.provider).toHaveBeenCalledTimes(1);
    gate.resolve(Response.json(f.receipt)); expect((await first).receipt).toEqual(f.receipt);
    // A new serial artifact receives a distinct reservation/key/provider ID;
    // the mock does not pretend a second create-only POST overwrites the first.
    f.descriptor.sequence++; f.receipt.sequence++;
    f.receipt.artifactId = "66666666-6666-4666-8666-666666666666";
    f.receipt.objectKey = "prepared/77777777-7777-4777-8777-777777777777";
    f.stored.id = "88888888-8888-4888-8888-888888888888";
    expect(await f.writer(f.input)).toEqual({ receipt: f.receipt, storageObjectId: f.stored.id }); expect(f.provider).toHaveBeenCalledTimes(10);
  });
  it.each(["reserve", "upload", "check", "get", "ack"] as const)("stops stalled %s fetch at the total 30s deadline, with no retry", async phase => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const f = fixture(p => { if (p === phase) { entered.resolve(); return new Promise<Response>(() => {}); } });
    // A provider lease beyond local clock still cannot extend the total timer.
    f.receipt.writeExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const operation = f.writer(f.input), rejected = expect(operation).rejects.toMatchObject({ code: "aborted" });
    await entered.promise; await vi.advanceTimersByTimeAsync(29_999); expect(f.order.at(-1)).toBe(phase);
    await vi.advanceTimersByTimeAsync(1); await rejected;
    const count = f.provider.mock.calls.length;
    await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_state" }); expect(f.provider).toHaveBeenCalledTimes(count);
    expect(f.provider.mock.calls.every(([, init]) => init.method !== "DELETE")).toBe(true);
  });
  it("honors the shorter reservation lease deadline and does not reset the total budget after reserve", async () => {
    vi.useFakeTimers(); const entered = Promise.withResolvers<void>();
    const f = fixture(phase => { if (phase === "upload") { entered.resolve(); return new Promise<Response>(() => {}); } });
    f.receipt.writeExpiresAt = new Date(Date.now() + 5_000).toISOString();
    const rejected = expect(f.writer(f.input)).rejects.toMatchObject({ code: "aborted" });
    await entered.promise; await vi.advanceTimersByTimeAsync(5_000); await rejected; expect(f.order).toEqual(["reserve", "upload"]);
    const reserveGate = Promise.withResolvers<Response>(), reserved = Promise.withResolvers<void>();
    const second = fixture(phase => {
      if (phase === "reserve") { reserved.resolve(); return reserveGate.promise; }
      if (phase === "upload") return new Promise<Response>(() => {});
    });
    second.receipt.writeExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const secondRejected = expect(second.writer(second.input)).rejects.toMatchObject({ code: "aborted" });
    await reserved.promise; await vi.advanceTimersByTimeAsync(20_000); reserveGate.resolve(Response.json(second.receipt));
    await vi.advanceTimersByTimeAsync(10_000); await secondRejected; expect(second.order).toEqual(["reserve", "upload"]);
  });
  it.each(["upload", "get", "ack"] as const)("cancels stalled %s response bodies on external abort", async phase => {
    const controller = new AbortController(), entered = Promise.withResolvers<void>(), cancel = vi.fn();
    const f = fixture(p => p === phase ? new Response(new ReadableStream({ pull() { entered.resolve(); }, cancel }, { highWaterMark: 0 })) : undefined);
    const rejected = expect(f.writer(f.input, controller.signal)).rejects.toMatchObject({ code: "aborted" });
    await entered.promise; controller.abort(); await rejected; expect(cancel).toHaveBeenCalledOnce();
    expect(f.order.at(-1)).toBe(phase);
    await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_state" });
  });
  it.each(["upload", "get", "ack"] as const)("cancels late %s response after uncertain abort without retry or DELETE", async phase => {
    const controller = new AbortController(), entered = Promise.withResolvers<void>(), late = Promise.withResolvers<Response>(), cancel = vi.fn();
    const f = fixture(p => { if (p === phase) { entered.resolve(); return late.promise; } });
    const rejected = expect(f.writer(f.input, controller.signal)).rejects.toMatchObject({ code: "aborted" });
    await entered.promise; controller.abort(); await rejected;
    const count = f.provider.mock.calls.length;
    late.resolve(new Response(new ReadableStream({ cancel }))); await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce(); expect(f.provider).toHaveBeenCalledTimes(count);
    await expect(f.writer(f.input)).rejects.toMatchObject({ code: "invalid_state" });
  });
  it("observes synchronous fetch abort/rejection and never exposes credentials", async () => {
    const controller = new AbortController();
    const f = fixture(() => { controller.abort(); return Promise.reject(new Error(`authorization ${credential} ${claim.claimTokenHash}`)); });
    await expect(f.writer(f.input, controller.signal)).rejects.toMatchObject({ code: "aborted", message: "aborted" });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.order).toEqual(["reserve"]);
  });
  it("cancels an already resolved response when abort lands between cleanup observer and wait continuation", async () => {
    const controller = new AbortController(), pending = Promise.withResolvers<Response>(), cancel = vi.fn(), entered = Promise.withResolvers<void>();
    // Registered before request's own pending.then. On resolution this queues
    // abort behind that cleanup observer, but ahead of wait's await continuation.
    // Returning the SAME promise (not an async wrapper) is essential to the race.
    void pending.promise.then(() => queueMicrotask(() => controller.abort()));
    const f = fixture();
    f.provider.mockImplementation((url: string) => { f.order.push(phaseOf(url)); entered.resolve(); return pending.promise; });
    const rejected = expect(f.writer(f.input, controller.signal)).rejects.toMatchObject({ code: "aborted" });
    await entered.promise;
    pending.resolve(new Response(new ReadableStream({ cancel }, { highWaterMark: 0 })));
    await rejected; await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce(); expect(f.order).toEqual(["reserve"]); expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it("refuses an already aborted call before network activity", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.writer(f.input, controller.signal)).rejects.toMatchObject({ code: "aborted" }); expect(f.provider).not.toHaveBeenCalled();
  });
  // Credential-bearing origin refusal is covered once in storage-reader.test.ts
  // against the shared config helper, under its exact ADR-0006 fixture binding.
  it.each(["https://synthetic.invalid/path", "https://synthetic.invalid/?key=secret",
    "http://synthetic.invalid", "http://localhost:12345", "http://127.0.0.1.synthetic.invalid:54321"])("refuses unexpected configured origin %s", configured => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", configured);
    expect(() => createPreparedArtifactWriter(claim)).toThrow("unavailable");
  });
  it("refuses missing credentials and malformed claims with closed errors", () => {
    expect(() => createPreparedArtifactWriter({ ...claim, claimTokenHash: credential })).toThrow("invalid_request");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); expect(() => createPreparedArtifactWriter(claim)).toThrow("unavailable");
  });
});
