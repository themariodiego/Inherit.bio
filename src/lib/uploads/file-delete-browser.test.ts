import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfHandle } from "@/lib/security/session-csrf-client";
import { deleteFileUntilSettled } from "./file-delete-browser";
import { fileDeletionError } from "@/copy/upload/file-deletion";
// api.file-delete's rendered one-time X-Inherit-CSRF token (G8.5), and the successors each answer issues.
const CSRF = `1800000000000.${"D".repeat(43)}.${"3".repeat(64)}`;
const csrf = () => csrfHandle(CSRF);
// api.file-delete's one-time value (G8.5, 20 November 2026): the one the Files
// page rendered for the file, and the next one each pending answer issues.
const NONCE = `1800000000000.${"V".repeat(43)}.${"6".repeat(64)}`;
const issuedValue = (n: number) => `1800000000000.${n.toString(36).padStart(43, "W")}.${"7".repeat(64)}`;
const id = "11111111-1111-4111-8111-111111111111";
let issued = 0;
/** A pending answer, issuing the next one-time value as the route does. */
const pending = () => {
  const response = Response.json({ error: "file_delete_pending" }, { status: 202 });
  response.headers.set("X-Inherit-Operation-Nonce", issuedValue(++issued));
  return response;
};
const sentValues = () => vi.mocked(fetch).mock.calls.map(([, args]) => (args?.headers as Record<string, string>)["X-Inherit-Operation-Nonce"]);
beforeEach(() => { issued = 0; vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("file deletion progress", () => {
  it("keeps polling the exact same DELETE until explicit 204", async () => {
    const next = (n: number) => `1800000000000.${"N".repeat(42)}${n}.${"4".repeat(64)}`;
    const issuing = (response: Response, n: number) => { response.headers.set("X-Inherit-CSRF", next(n)); return response; };
    vi.mocked(fetch).mockResolvedValueOnce(issuing(pending(), 1)).mockResolvedValueOnce(issuing(pending(), 2)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const operation = deleteFileUntilSettled(id, new AbortController().signal, csrfHandle(`1800000000000.${"E".repeat(43)}.${"5".repeat(64)}`), NONCE);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await operation).toEqual({ status: "deleted" });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [path, args] of vi.mocked(fetch).mock.calls) { expect(path).toBe(`/api/files/${id}`); expect(args?.method).toBe("DELETE"); expect(args?.signal).toBeInstanceOf(AbortSignal); }
    // Each DELETE spends the current token and sends the successor the last answer issued.
    expect(vi.mocked(fetch).mock.calls.map(([, args]) => (args?.headers as Record<string, string>)["X-Inherit-CSRF"]))
      .toEqual([`1800000000000.${"E".repeat(43)}.${"5".repeat(64)}`, next(1), next(2)]);
    // And one one-time value: the page's first, then the one each pending answer issued.
    expect(sentValues()).toEqual([NONCE, issuedValue(1), issuedValue(2)]);
  });
  it("stops after five minutes with pending, never completion", async () => {
    vi.mocked(fetch).mockImplementation(async () => pending());
    const operation = deleteFileUntilSettled(id, new AbortController().signal, csrf(), NONCE);
    await vi.advanceTimersByTimeAsync(300000);
    expect(await operation).toEqual({ status: "pending" }); expect(fetch).toHaveBeenCalledTimes(150);
    // Never one value twice.
    expect(new Set(sentValues()).size).toBe(150);
  });
  it("unmount cancellation interrupts the wait and prevents further DELETE", async () => {
    vi.mocked(fetch).mockResolvedValue(pending()); const controller = new AbortController();
    const operation = deleteFileUntilSettled(id, controller.signal, csrf(), NONCE);
    await vi.advanceTimersByTimeAsync(1); controller.abort();
    expect(await operation).toEqual({ status: "pending" }); await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(1);
  });
  // G8.5, 20 November 2026: a repeat spends a value too, so a pending answer
  // that issues none, or one the client cannot send, ends the repeats; the
  // page then renders a fresh value for the file.
  it.each([["no next value", null], ["a malformed one", "not-a-value"], ["the value just sent", NONCE]] as const)(
    "ends as pending after one request when a pending answer issues %s", async (_label, next) => {
      const response = Response.json({ error: "file_delete_pending" }, { status: 202 });
      if (next !== null) response.headers.set("X-Inherit-Operation-Nonce", next);
      vi.mocked(fetch).mockResolvedValue(response);
      const operation = deleteFileUntilSettled(id, new AbortController().signal, csrf(), NONCE);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await operation).toEqual({ status: "pending" }); expect(fetch).toHaveBeenCalledTimes(1);
      expect(sentValues()).toEqual([NONCE]);
    });
  it.each([Response.json({}), Response.json({ error: "file_delete_pending", extra: true }, { status: 202 }),
    Response.json({ error: "file_delete_failed" }, { status: 202 })])("does not infer success or retry malformed receipts", async response => {
    vi.mocked(fetch).mockResolvedValue(response); expect((await deleteFileUntilSettled(id, new AbortController().signal, csrf(), NONCE)).status).toBe("failed"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  // The route's sign-in and not-found refusals are the register's generic
  // bodies (G8.5, 19 November 2026); a person reads the sentence the route's
  // own bodies gave (file_delete_unauthorized, file_delete_not_found). Its
  // cross-origin refusal is the register's request_forbidden, which reads as
  // an unfinished deletion (owner decision of 19 November 2026). Since 20
  // November 2026 a missing, spent, expired or foreign one-time value is the
  // same 403 and reads the same.
  it.each([
    [401, "unauthenticated", "Please sign in again and try Delete."],
    [404, "not_found", "This file is not available. Please check your files again."],
    [403, "request_forbidden", "Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete."],
  ] as const)("returns a %i %s refusal without another request, worded as decided", async (status, error, sentence) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error }, { status }));
    const result = await deleteFileUntilSettled(id, new AbortController().signal, csrf(), NONCE);
    expect(result).toEqual({ status: "failed", code: error }); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fileDeletionError(result.status === "failed" ? result.code : null)).toBe(sentence);
  });
  it("words the CSRF wrapper's refusal as an unfinished deletion, as before", () => {
    expect(fileDeletionError("request_forbidden")).toBe(fileDeletionError(null));
  });
  it("keeps no sentence for file_delete_unauthorized, which no answer of the route carries any more", () => {
    expect(fileDeletionError("file_delete_unauthorized")).toBe(fileDeletionError(null));
  });
  it("refuses a changed-path identifier before any request", async () => {
    expect((await deleteFileUntilSettled("../other", new AbortController().signal, csrf(), NONCE)).status).toBe("failed"); expect(fetch).not.toHaveBeenCalled();
  });
});
