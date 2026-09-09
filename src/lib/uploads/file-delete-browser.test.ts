import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFileUntilSettled } from "./file-delete-browser";
const id = "11111111-1111-4111-8111-111111111111";
const pending = () => Response.json({ error: "file_delete_pending" }, { status: 202 });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("file deletion progress", () => {
  it("keeps polling the exact same DELETE until explicit 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const operation = deleteFileUntilSettled(id, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await operation).toEqual({ status: "deleted" });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [path, args] of vi.mocked(fetch).mock.calls) { expect(path).toBe(`/api/files/${id}`); expect(args?.method).toBe("DELETE"); expect(args?.signal).toBeInstanceOf(AbortSignal); }
  });
  it("stops after five minutes with pending, never completion", async () => {
    vi.mocked(fetch).mockImplementation(async () => pending());
    const operation = deleteFileUntilSettled(id, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(300000);
    expect(await operation).toEqual({ status: "pending" }); expect(fetch).toHaveBeenCalledTimes(150);
  });
  it("unmount cancellation interrupts the wait and prevents further DELETE", async () => {
    vi.mocked(fetch).mockResolvedValue(pending()); const controller = new AbortController();
    const operation = deleteFileUntilSettled(id, controller.signal);
    await vi.advanceTimersByTimeAsync(1); controller.abort();
    expect(await operation).toEqual({ status: "pending" }); await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([Response.json({}), Response.json({ error: "file_delete_pending", extra: true }, { status: 202 }),
    Response.json({ error: "file_delete_failed" }, { status: 202 })])("does not infer success or retry malformed receipts", async response => {
    vi.mocked(fetch).mockResolvedValue(response); expect((await deleteFileUntilSettled(id, new AbortController().signal)).status).toBe("failed"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns an authorization refusal without another request", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "file_delete_unauthorized" }, { status: 401 }));
    expect(await deleteFileUntilSettled(id, new AbortController().signal)).toEqual({ status: "failed", code: "file_delete_unauthorized" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses a changed-path identifier before any request", async () => {
    expect((await deleteFileUntilSettled("../other", new AbortController().signal)).status).toBe("failed"); expect(fetch).not.toHaveBeenCalled();
  });
});
