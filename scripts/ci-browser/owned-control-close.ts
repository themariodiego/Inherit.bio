import type { ReadStream } from "node:fs";

/** ReadStream.destroy owns its descriptor, including with autoClose:false.
 * No child may start until that single asynchronous close has settled. */
export async function settleOwnedControlClose(source: ReadStream): Promise<void> {
  const refused = () => new Error("Operator-control close unresolved");
  if (source.closed) {
    if (source.errored !== null) throw refused();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let failed = source.errored !== null;
    const cleanup = () => {
      clearTimeout(timer); source.off("error", onError); source.off("close", onClose);
    };
    const onError = () => { failed = true; };
    const onClose = () => {
      cleanup();
      if (!source.closed || failed) reject(refused()); else resolve();
    };
    const timer = setTimeout(() => { cleanup(); reject(refused()); }, 5000);
    source.on("error", onError); source.once("close", onClose);
    try { source.destroy(); } catch { cleanup(); reject(refused()); }
  });
}
