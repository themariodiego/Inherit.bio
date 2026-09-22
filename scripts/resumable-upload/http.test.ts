import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./http";
import { responseReceipt } from "./receipt";

afterEach(() => vi.useRealTimers());
describe("bounded diagnostic HTTP", () => {
  it("does not follow a redirect or inspect its body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 307, headers: { Location: "https://inherit.bio/private" } });
    const fetch = vi.fn(async () => response);
    await expect(request(fetch, "https://example.invalid", { method: "HEAD" })).rejects.toThrow("probe_contract_refused");
    expect(fetch).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds app JSON before parsing and cancels its stream", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(16_385));
    }, cancel }), { status: 201 });
    await expect(request(async () => response, "https://example.invalid", {}, true)).rejects.toThrow("probe_contract_refused");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels provider bodies without retaining them", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("secret provider body"));
    }, cancel }), { status: 201, headers: { "x-private-key": "not-in-receipt" } });
    const result = await request(async () => response, "https://example.invalid", {});
    expect(result).toEqual({ safe: { status: 201, offset: null, length: null, tusVersion: null }, location: null });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts a stalled request at the per-request bound without retries", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = request(fetch, "https://example.invalid", {});
    const assertion = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("honors the remaining run bound and refuses an expired run before fetching", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = request(fetch, "https://example.invalid", {}, false, 25);
    const assertion = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25); await assertion;
    await expect(request(fetch, "https://example.invalid", {}, false, 0)).rejects.toThrow("probe_contract_refused");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds a hung response cancellation even when the transport ignores abort", async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { status: 201 });
    const result = request(async () => response, "https://example.invalid", {});
    const assertion = expect(result).rejects.toThrow("probe_request_timeout");
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("only retains canonical integer offsets and recognized protocol headers", () => {
    for (const bad of ["-1", "0x0", "1.0", "01", "9007199254740992", "private-data"]) {
      expect(responseReceipt(new Response(null, { headers: { "Upload-Offset": bad,
        "Upload-Length": bad, "Tus-Resumable": "private-value" } }))).toEqual({ status: 200, offset: null, length: null, tusVersion: null });
    }
  });
});
