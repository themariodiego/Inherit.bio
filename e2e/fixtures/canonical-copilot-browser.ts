import { expect, type Page, type Response } from "@playwright/test";
import type { CanonicalProviderPlan } from "./canonical-copilot-provider";

export const COPILOT_MODEL_HOST = "model.copilot.test";
export const CAFFEINE_SLUG = "caffeine-metabolism-cyp1a2-rs762551";
export const CAFFEINE_PROMPT = "What is my caffeine genotype?";
export const CAFFEINE_ANSWER = "According to your Caffeine metabolism report (CYP1A2, rs762551), your genotype is A/C. This is informational, not medical advice.";
export type FixtureSnapshot = { calls: number; denied: number; requests: Array<{ prompt: string; stage: "tool" | "answer";
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }> }> };

export async function startCopilotFixture(port: 8123 | 8125 | 8126) {
  const address = process.env.CANONICAL_COPILOT_CONTROL_URL;
  if (!address) throw new Error("Canonical Copilot requires the isolated HTTPS fixture daemon; set CANONICAL_COPILOT_CONTROL_URL. No loopback-as-cloud fallback exists.");
  const url = new URL(address);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Fixture control must be an explicit host-loopback origin");
  async function command(action: string, extra = {}) {
    const response = await fetch(new URL("/fixture", url), { method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, port, ...extra }), signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw new Error(`Synthetic fixture ${action} failed (${response.status})`);
    return response.json();
  }
  await command("start");
  return { baseUrl: `https://${COPILOT_MODEL_HOST}:${port}/v1`,
    configure: (plan: CanonicalProviderPlan) => command("configure", { plan }),
    snapshot: (): Promise<FixtureSnapshot> => command("snapshot"),
    waitUntilPaused: () => command("wait"), release: () => command("release"), stop: () => command("stop") };
}
export type CopilotFixture = Awaited<ReturnType<typeof startCopilotFixture>>;

type NativeChatObservation = { status: number; text: string };
type ChatObserverWindow = Window & { __inheritChatObserver?: {
  nativeFetch: typeof fetch; observedFetch: typeof fetch; body: Promise<NativeChatObservation>; cancel: () => void;
} };
/** Observe the one real response before the UI cancels its error-body branch.
 * The original request and response reach the browser/app unchanged. */
export async function observeNextChatResponse(page: Page) {
  await page.evaluate(() => {
    const target = window as ChatObserverWindow;
    if (target.__inheritChatObserver) throw new Error("Chat response observer already installed");
    const nativeFetch = window.fetch;
    let resolve!: (value: NativeChatObservation) => void;
    let reject!: (reason: Error) => void;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let disposed = false;
    const body = new Promise<NativeChatObservation>((yes, no) => { resolve = yes; reject = no; });
    void body.catch(() => {});
    const observedFetch: typeof fetch = async (...args) => {
      const [input, init] = args;
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin !== location.origin || url.pathname !== "/api/chat" || url.search || method.toUpperCase() !== "POST")
        return nativeFetch.apply(window, args);
      window.fetch = nativeFetch;
      try {
        const response = await nativeFetch.apply(window, args);
        if (disposed) return response;
        const clone = response.clone();
        void (async () => {
          const deadline = setTimeout(() => {
            reject(new Error("Native chat body observation timed out"));
            if (reader) void reader.cancel().catch(() => {});
          }, 10000);
          try {
            if (!clone.body) throw new Error("Missing native chat response body");
            reader = clone.body.getReader();
            const decoder = new TextDecoder("utf-8", { fatal: true });
            let bytes = 0, text = "";
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              bytes += next.value.byteLength;
              if (bytes > 4096) throw new Error("Observed chat denial exceeded its body limit");
              text += decoder.decode(next.value, { stream: true });
            }
            resolve({ status: response.status, text: text + decoder.decode() });
          } catch { reject(new Error("Could not observe bounded native chat response body")); }
          finally { clearTimeout(deadline); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; } }
        })();
        return response;
      } catch (error) { reject(new Error("Native chat request failed")); throw error; }
    };
    target.__inheritChatObserver = { nativeFetch, observedFetch, body, cancel: () => {
      disposed = true;
      reject(new Error("Native chat response observer disposed"));
      if (reader) void reader.cancel().catch(() => {});
    } };
    window.fetch = observedFetch;
  });
  return {
    read: () => page.evaluate(() => (window as ChatObserverWindow).__inheritChatObserver!.body),
    dispose: () => page.evaluate(() => {
      const target = window as ChatObserverWindow, observer = target.__inheritChatObserver;
      if (observer && window.fetch === observer.observedFetch) window.fetch = observer.nativeFetch;
      observer?.cancel();
      delete target.__inheritChatObserver;
    }),
  };
}

export async function saveCopilotProvider(page: Page, baseUrl: string) {
  await page.goto("/settings/copilot");
  await page.getByLabel("Provider", { exact: true }).click();
  await page.getByRole("option", { name: /OpenAI-compatible/ }).click();
  await page.getByLabel("Base URL").fill(baseUrl);
  await page.getByLabel("Model", { exact: true }).fill("mock-model");
  await page.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect(page.getByText("Provider saved. Review the separate Copilot permission below.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Copilot permission", exact: true })).toContainText(baseUrl.replace(/\/v1$/, ""));
}
export async function allowCopilot(page: Page) {
  const permission = page.getByRole("region", { name: "Copilot permission", exact: true });
  await permission.getByRole("checkbox", { name: "I allow this model to use the listed information for my Copilot answers. I can withdraw this permission.", exact: true }).check();
  const granted=page.waitForResponse(response => new URL(response.url()).pathname === "/api/consents" && response.request().method() === "POST");
  await permission.getByRole("button", { name: "Allow Copilot for this model", exact: true }).click();
  const response=await granted;
  expect(response.status()).toBe(201);
  expect(await response.json()).toEqual({ granted:true });
  await expect(permission.getByText("Copilot is allowed for this model configuration.", { exact: true })).toBeVisible();
}
type ExpectedCitation = { id: string; label: string; href: string };
// Read the provider's actual captured report receipt, never today's catalog or
// the response under assertion. These cases deliberately use the caffeine report.
export function expectedCaffeineCitations(report: Record<string, unknown>): ExpectedCitation[] {
  expect(report.slug).toBe(CAFFEINE_SLUG);
  expect(Array.isArray(report.sources)).toBe(true);
  const sources = report.sources as Array<{ title: string; citations: unknown[]; catalogSnapshot: {
    schemaVersion: number; templateSha256: string; template: { slug: string; title: string;
      citations: Array<{ pmid: string; label: string }> } } }>;
  expect(sources.length).toBeGreaterThan(0);
  const expected = new Map<string, ExpectedCitation>();
  for (const source of sources) {
    const snapshot = source.catalogSnapshot;
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.templateSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.template.slug).toBe(CAFFEINE_SLUG);
    expect(snapshot.template.title).toBe("Caffeine metabolism · CYP1A2");
    expect(source.title).toBe(snapshot.template.title);
    expect(source.citations).toEqual(snapshot.template.citations);
    expect(snapshot.template.citations).toHaveLength(1);
    const publication = snapshot.template.citations[0];
    expect(publication).toMatchObject({ pmid: "10233211", label: "Sachse et al., Br J Clin Pharmacol 1999" });
    const reportId = `report:${snapshot.template.slug}:${snapshot.templateSha256}`;
    expected.set(reportId, { id: reportId, label: snapshot.template.title,
      href: `/genome/me/reports/${snapshot.template.slug}` });
    const publicationId = `pmid:${publication.pmid}`;
    expected.set(publicationId, { id: publicationId, label: publication.label,
      href: `https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}/` });
  }
  return [...expected.values()];
}
export async function expectClosedCompletion(response: Response, expected: string, citations: ExpectedCitation[] = []) {
  const request = response.request(), url = new URL(request.url());
  expect(request.method()).toBe("POST"); expect(url.pathname).toBe("/api/chat"); expect(url.search).toBe("");
  const submitted = request.postDataJSON();
  expect(Object.keys(submitted).sort()).toEqual("chatId" in submitted ? ["chatId", "message"] : ["contextToken", "message"]);
  expect(typeof submitted.message).toBe("string");
  // Assert token shape only, so a failed assertion never dumps that capability.
  if (!("chatId" in submitted)) expect(typeof submitted.contextToken === "string" && submitted.contextToken.length > 0).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["chatId", "message"]);
  expect(body.chatId).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers()["x-inherit-chat-id"]).toBe(body.chatId);
  if ("chatId" in submitted) expect(submitted.chatId).toBe(body.chatId);
  expect(body.message).toEqual({ role: "assistant", content: expected, citations, embryoFindings: [] });
  return body.chatId as string;
}
export function lastToolResult(snapshot: FixtureSnapshot): Record<string, unknown> {
  expect(snapshot.denied).toBe(0);
  const turn = snapshot.requests.at(-1);
  expect(turn?.stage).toBe("answer");
  const message = turn!.messages.at(-1)!;
  expect(message.role).toBe("tool");
  if (typeof message.content === "string") return JSON.parse(message.content);
  // SDK versions may encode the tool result as a typed text content block.
  if (Array.isArray(message.content)) {
    const text = message.content.find(part => part && typeof part === "object" && "text" in part)?.text;
    if (typeof text === "string") return JSON.parse(text);
  }
  throw new Error("Provider did not receive a JSON tool result");
}
