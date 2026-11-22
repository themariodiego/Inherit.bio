import type { CsrfHandle } from "@/lib/security/session-csrf-client";

/** The request and response header of api.file-delete's one-time value, as the register writes it. */
export const FILE_DELETE_NONCE_HEADER = "X-Inherit-Operation-Nonce";
/** The value's shape (`<expiresAt>.<random>.<mac>`), as the Files page renders it and a pending answer issues the next. */
const OPERATION_NONCE = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/;

/** Repeats only the same owner-authorized DELETE after its explicit pending
 * receipt. A timeout never means deletion completed. Each DELETE spends the
 * route's current one-time X-Inherit-CSRF token and keeps the successor.
 *
 * Each DELETE also carries one one-time X-Inherit-Operation-Nonce (G8.5, 20
 * November 2026, "where the register is stricter, engineering codes to it"):
 * the first is the one the Files page rendered for this file, and each
 * pending answer issues the next in the same header, because the database
 * spends every value it is sent. A pending answer that issues none ends the
 * repeats as pending; the page then renders a fresh value for the file. */
export async function deleteFileUntilSettled(fileId: string, external: AbortSignal, csrf: CsrfHandle, nonce: string): Promise<
  { status: "deleted" } | { status: "pending" } | { status: "failed"; code: unknown }
> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return { status: "failed", code: null };
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 300_000);
  const signal = AbortSignal.any([external, deadline.signal]);
  async function wait() {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(delay); signal.removeEventListener("abort", stop); reject(new Error("delete_aborted")); };
      const delay = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, 2000);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
    });
  }
  let operationNonce = nonce;
  try {
    while (!signal.aborted) {
      const current = operationNonce;
      const response = await csrf.send((csrfToken) => fetch(`/api/files/${fileId}`, { method: "DELETE", signal,
        headers: { "X-Inherit-CSRF": csrfToken, "X-Inherit-Operation-Nonce": current } }));
      signal.throwIfAborted();
      if (response.status === 204) return { status: "deleted" };
      const raw: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      const code = raw && typeof raw === "object" && "error" in raw ? raw.error : null;
      if (response.status !== 202) return { status: "failed", code };
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || code !== "file_delete_pending") {
        return { status: "failed", code: null };
      }
      const next = response.headers.get(FILE_DELETE_NONCE_HEADER);
      if (!next || !OPERATION_NONCE.test(next) || next === current) return { status: "pending" };
      operationNonce = next;
      await wait();
    }
    return { status: "pending" };
  } catch {
    return deadline.signal.aborted || external.aborted ? { status: "pending" } : { status: "failed", code: null };
  } finally { clearTimeout(timer); }
}
