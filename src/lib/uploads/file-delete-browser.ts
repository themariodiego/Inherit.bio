/** Repeats only the same owner-authorized DELETE after its explicit pending
 * receipt. A timeout never means deletion completed. */
export async function deleteFileUntilSettled(fileId: string, external: AbortSignal): Promise<
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
  try {
    while (!signal.aborted) {
      const response = await fetch(`/api/files/${fileId}`, { method: "DELETE", signal });
      signal.throwIfAborted();
      if (response.status === 204) return { status: "deleted" };
      const raw: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      const code = raw && typeof raw === "object" && "error" in raw ? raw.error : null;
      if (response.status !== 202) return { status: "failed", code };
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 1 || code !== "file_delete_pending") {
        return { status: "failed", code: null };
      }
      await wait();
    }
    return { status: "pending" };
  } catch {
    return deadline.signal.aborted || external.aborted ? { status: "pending" } : { status: "failed", code: null };
  } finally { clearTimeout(timer); }
}
