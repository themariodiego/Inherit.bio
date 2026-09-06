import { afterEach, describe, expect, it, vi } from "vitest";
import { hasEmptyRequestBody } from "./empty-request-body";
const request = (body?: BodyInit) => new Request("http://localhost/test", {
  method: "POST", body, ...{ duplex: "half" },
});
afterEach(() => vi.useRealTimers());
describe("bodyless HTTP mutations", () => {
  it("accepts null and zero-byte stream bodies", async () => {
    expect(await hasEmptyRequestBody(request())).toBe(true);
    expect(await hasEmptyRequestBody(request(new Uint8Array()))).toBe(true);
    expect(await hasEmptyRequestBody(request(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array()); controller.close();
    } })))).toBe(true);
  });
  it("refuses even one byte without trusting a false zero Content-Length", async () => {
    const req = request("x"); req.headers.set("content-length", "0");
    expect(await hasEmptyRequestBody(req)).toBe(false);
    expect(await hasEmptyRequestBody(request("{}"))).toBe(false);
  });
  it("cancels unread bytes after the first nonempty chunk", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel });
    expect(await hasEmptyRequestBody(request(stream))).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("refuses a stalled request within a fixed deadline", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const result = hasEmptyRequestBody(request(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(false); expect(cancel).toHaveBeenCalledOnce();
  });
});
