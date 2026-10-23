import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// The compatibility panel's real client handler, with retained hook state and
// no DOM, server or network, as src/components/chat/own-chat-panel.test.ts
// runs its panel. It sends the registered { contextToken, message } since
// 23 October 2026 (G8.5). Every value is synthetic.
const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0,
  refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = initial;
    return [harness.state[index], (next: unknown) => { harness.state[index] = typeof next === "function"
      ? (next as (previous: unknown) => unknown)(harness.state[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = harness.refCursor++;
    return harness.refs[index] ??= { current: initial }; },
  useEffect: () => undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("./consent-dialog", () => ({ ConsentDialog: "x-consent-dialog" }));
// The page's rendered one-time X-Inherit-CSRF token (G8.5). The provider and
// its context are tested in src/lib/security; here the handler's request is.
const CSRF = vi.hoisted(() => `1800000000000.${"C".repeat(43)}.${"b".repeat(64)}`);
vi.mock("@/components/security/csrf-provider", async () => {
  const { csrfHandle } = await import("@/lib/security/session-csrf-client");
  return { useCsrf: () => csrfHandle(CSRF) };
});
import { ChatPanel } from "./chat-panel";
import { refusalFor } from "@/copy/copilot/refusals";

const props = { contextToken: "synthetic-compat-token", displayLabel: "You",
  info: { configured: true, local: false, providerKey: "model.synthetic.invalid", model: "synthetic-model", hasConsent: false } };
type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as Element, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function render(token = props.contextToken) { harness.cursor = 0; harness.refCursor = 0; return ChatPanel({ ...props, contextToken: token }); }
function control(tree: ReactNode, type: string, label?: string) {
  const found = elements(tree).find(node => node.type === type && (label === undefined || text(node.props.children as ReactNode).includes(label)));
  if (!found) throw new Error(`Expected ${type} ${label ?? ""}`);
  return found.props;
}
function ask(question: string) {
  (control(render(), "textarea").onChange as (event: unknown) => void)({ target: { value: question } });
  (control(render(), "form").onSubmit as (event: unknown) => void)({ preventDefault() {} });
}
beforeEach(() => { harness.state = []; harness.refs = []; vi.clearAllMocks(); vi.stubGlobal("fetch", harness.fetch); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the compatibility Copilot panel", () => {
  it("sends the registered body with the page's token to /api/chat with no query, and shows the answer", async () => {
    harness.fetch.mockResolvedValueOnce(Response.json({ chatId: "80000000-0000-4000-8000-000000000001",
      message: { role: "assistant", content: "Your file does not cover that variant.", citations: [], embryoFindings: [] } }));
    ask("What does my file say about caffeine?");
    const [url, init] = harness.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Inherit-CSRF"], "the route's one-time token").toBe(CSRF);
    expect(JSON.parse(String(init.body))).toEqual({ contextToken: "synthetic-compat-token", message: "What does my file say about caffeine?" });
    await vi.waitFor(() => expect(text(render())).toContain("Your file does not cover that variant."));
    expect(text(render())).toContain("What does my file say about caffeine?");
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the question and Thinking while the request is open, and disables Send", async () => {
    let release!: (response: Response) => void;
    harness.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { release = resolve; }));
    ask("What is my caffeine genotype?");
    let tree = render();
    expect(text(tree)).toContain("What is my caffeine genotype?");
    expect(text(tree)).toContain("Thinking…");
    expect(control(tree, "button", "Send").disabled).toBe(true);
    release(Response.json({ error: "consent_required", provider_key: "model.synthetic.invalid" }, { status: 403 }));
    await vi.waitFor(() => expect(text(render())).toContain("Review what would be shared"));
    tree = render();
    expect(text(tree)).not.toContain("Thinking…");
    expect(control(tree, "button", "Send").disabled).toBe(false);
  });

  it("offers the consent review for the provider the route names, and the setup sentence for a missing provider or key", async () => {
    harness.fetch.mockResolvedValueOnce(Response.json({ error: "consent_required", provider_key: "model.synthetic.invalid" }, { status: 403 }));
    ask("What is my caffeine genotype?");
    await vi.waitFor(() => expect(text(render())).toContain("Review what would be shared"));
    (control(render(), "button", "Review what would be shared").onClick as () => void)();
    expect(control(render(), "x-consent-dialog")).toMatchObject({ open: true, providerKey: "model.synthetic.invalid" });
    for (const code of ["no_provider", "no_key"]) {
      harness.fetch.mockResolvedValueOnce(Response.json({ error: code, message: "Synthetic." }, { status: 409 }));
      ask("What is my caffeine genotype?");
      await vi.waitFor(() => expect(text(render())).toContain("Configure a provider in"));
    }
  });

  it("shows the registered refusal for a gated question as the assistant's turn", async () => {
    harness.fetch.mockResolvedValueOnce(new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream", "x-copilot-refusal": "diagnosis" } }));
    ask("Do I have cancer?");
    await vi.waitFor(() => expect(text(render())).toContain(refusalFor("diagnosis", "You")));
  });

  it("says the request failed for any other answer, without showing a reply", async () => {
    harness.fetch.mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }));
    ask("What is my caffeine genotype?");
    await vi.waitFor(() => expect(text(render())).toContain("The copilot request failed."));
    expect(elements(render()).filter(node => node.props["data-role"] === "assistant")).toHaveLength(0);
  });
});
