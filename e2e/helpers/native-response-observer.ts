import type { Page } from "@playwright/test";

type Observation = { status: number; text: string };
type ObserverWindow = Window & { __inheritNativeResponseObserver?: {
  nativeFetch: typeof fetch;
  observedFetch: typeof fetch;
  responses: Record<string, Promise<Observation>>;
  matchCounts: Record<string, number>;
  cancel: () => void;
} };

/** Observe exact response bytes from the browser's real fetch. No request is
 * replayed, and the app receives the original response, headers and body. The
 * keys name anchored pathname regexes; each must match exactly one POST. */
export async function observeNativeResponses(page: Page, paths: Record<string, string>) {
  if (!Object.keys(paths).length || Object.values(paths).some(path => !path.startsWith("^") || !path.endsWith("$")))
    throw new Error("Native response observations require named anchored paths");
  await page.evaluate(paths => {
    const target = window as ObserverWindow;
    if (target.__inheritNativeResponseObserver) throw new Error("Native response observer already installed");
    const nativeFetch = window.fetch;
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    const pending = Object.fromEntries(Object.entries(paths).map(([key, source]) => {
      let resolve!: (value: Observation) => void, reject!: (error: Error) => void;
      const body = new Promise<Observation>((yes, no) => { resolve = yes; reject = no; });
      void body.catch(() => {});
      return [key, { key, pattern: new RegExp(source), body, resolve, reject }];
    }));
    const matchCounts = Object.fromEntries(Object.keys(paths).map(key => [key, 0]));
    let disposed = false;
    const observedFetch: typeof fetch = async (...args) => {
      const [input, init] = args;
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const matches = url.origin === location.origin && !url.search && method.toUpperCase() === "POST"
        ? Object.values(pending).filter(entry => entry.pattern.test(url.pathname)) : [];
      if (matches.length > 1) throw new Error("Ambiguous native response observation");
      const entry = matches[0];
      if (!entry) return nativeFetch.apply(window, args);
      const first = ++matchCounts[entry.key] === 1;
      if (!first) entry.reject(new Error("Duplicate native response observation"));
      try {
        const response = await nativeFetch.apply(window, args);
        if (disposed || !first) return response;
        const clone = response.clone();
        void (async () => {
          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
          const deadline = setTimeout(() => {
            entry.reject(new Error("Native response body observation timed out"));
            if (reader) void reader.cancel().catch(() => {});
          }, 10000);
          try {
            if (!clone.body) {
              if (clone.status===204||clone.status===205) {
                entry.resolve({status:response.status,text:""});
                return;
              }
              throw new Error("Missing native response body");
            }
            reader = clone.body.getReader(); readers.add(reader);
            const decoder = new TextDecoder("utf-8", { fatal: true });
            let bytes = 0, text = "";
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              bytes += next.value.byteLength;
              if (bytes > 4096) throw new Error("Native response exceeded its body limit");
              text += decoder.decode(next.value, { stream: true });
            }
            entry.resolve({ status: response.status, text: text + decoder.decode() });
          } catch { entry.reject(new Error("Could not observe bounded native response body")); }
          finally {
            clearTimeout(deadline);
            if (reader) {
              readers.delete(reader); void reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          }
        })();
        return response;
      } catch (error) { entry.reject(new Error("Native request failed")); throw error; }
    };
    target.__inheritNativeResponseObserver = {
      nativeFetch, observedFetch, matchCounts,
      responses: Object.fromEntries(Object.entries(pending).map(([key, entry]) => [key, entry.body])),
      cancel: () => {
        disposed = true;
        for (const entry of Object.values(pending)) entry.reject(new Error("Native response observer disposed"));
        for (const reader of readers) void reader.cancel().catch(() => {});
      },
    };
    window.fetch = observedFetch;
  }, paths);
  return {
    read: (key: string) => page.evaluate(async key => {
      const observer = (window as ObserverWindow).__inheritNativeResponseObserver;
      if (!observer?.responses[key]) throw new Error("Unknown native response observation");
      if (observer.matchCounts[key] > 1) throw new Error("Duplicate native response observation");
      const response = await observer.responses[key];
      if (observer.matchCounts[key] !== 1) throw new Error("Duplicate native response observation");
      return response;
    }, key),
    dispose: () => page.evaluate(() => {
      const target = window as ObserverWindow, observer = target.__inheritNativeResponseObserver;
      if (observer && window.fetch === observer.observedFetch) window.fetch = observer.nativeFetch;
      observer?.cancel(); delete target.__inheritNativeResponseObserver;
    }),
  };
}
