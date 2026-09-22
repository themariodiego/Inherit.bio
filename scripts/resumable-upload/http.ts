import { REQUEST_TIMEOUT_MS, refuse } from "./contract";
import { responseReceipt, type SafeHeaders } from "./receipt";

export type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface ProbeResponse { safe: SafeHeaders; location: string | null; json?: unknown }

/** Redirects and implicit retries are forbidden. App JSON is bounded; all
 * provider bodies and arbitrary headers are discarded without logging. */
export async function request(fetch: ProbeFetch, url: string, init: RequestInit, appJson = false,
  remainingMs = REQUEST_TIMEOUT_MS): Promise<ProbeResponse> {
  if (remainingMs <= 0) refuse();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("probe_request_timeout")); },
      Math.min(remainingMs, REQUEST_TIMEOUT_MS));
  });
  let response: Response | undefined;
  const operation = async () => { try {
    response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (response.redirected || (response.status >= 300 && response.status < 400)) refuse();
    const result: ProbeResponse = { safe: responseReceipt(response), location: response.headers.get("location") };
    if (appJson && response.status === 201) {
      const reader = response.body?.getReader();
      if (!reader) refuse();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 16_384) refuse();
          chunks.push(next.value);
        }
        result.json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    return result;
  } finally {
    await response?.body?.cancel().catch(() => {});
  } };
  // The race also bounds body reads and cancel(), including a transport that
  // fails to settle when aborted. A lost response remains an unknown outcome.
  try { return await Promise.race([operation(), expired]); }
  finally { clearTimeout(timer!); }
}
