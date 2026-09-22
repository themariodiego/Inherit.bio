interface IgvApi {
  createBrowser(element: HTMLElement, config: unknown): Promise<unknown>;
  removeBrowser(browser: unknown): void;
}

/** Own one viewer, including an initialization that finishes after cancellation. */
export function createIgvBrowser(
  igv: IgvApi,
  container: HTMLElement,
  config: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ browser: unknown; element: HTMLElement }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    // A separate host keeps a cancelled creation out of a newer viewer's DOM.
    // IGV owns the host's shadow root; clearing container.innerHTML cannot
    // remove library roots inside a shadow tree or release global listeners.
    const element = document.createElement("div");
    container.appendChild(element);
    let browser: unknown;
    let stopped = false;
    let removed = false;
    const remove = () => {
      if (!browser || removed) return;
      removed = true;
      const handler = typeof browser === "object" ? Reflect.get(browser, "keyUpHandler") : undefined;
      try { igv.removeBrowser(browser); }
      finally {
        // IGV 3.8.5 removeKeyboardHandler adds this exact callback instead of
        // removing it. Remove only this instance's callback after disposal.
        if (typeof handler === "function") document.removeEventListener("keyup", handler);
      }
    };
    const stop = (reason: unknown) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      element.remove();
      remove();
      reject(reason);
    };
    const abort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(new Error(`igv.createBrowser timed out after ${timeoutMs}ms`)), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    // Keep the creation promise observed after timeout/unmount. A late native
    // instance still belongs to this attempt and must never become the next one.
    Promise.resolve().then(() => {
      if (stopped) return;
      return igv.createBrowser(element, config);
    }).then(value => {
      if (!value) return;
      browser = value;
      if (stopped) { remove(); return; }
      clearTimeout(timer);
      resolve({ browser, element });
    }, stop);
  });
}
