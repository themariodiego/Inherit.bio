import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Execute the actual client handlers with retained hook state, without a DOM,
// application server or network. Layout/accessibility stays in browser CI.
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
import { OwnChatPanel } from "./own-chat-panel";
import { ownChatCorrection, OWN_CHAT_CORRECTION_NOTICE } from "@/lib/copilot/own-chat-correction";

const chatId = "80000000-0000-4000-8000-000000000003";
const messages = [{ id: "80000000-0000-4000-8000-000000000004", role: "user", content: "Earlier question", citations: [], embryoFindings: [], createdAt: "2026-09-07T10:00:00.000Z" },
  { id: "80000000-0000-4000-8000-000000000005", role: "assistant", content: "Earlier paraphrased claim", citations: [], embryoFindings: [], createdAt: "2026-09-07T10:00:01.000Z" }];
const props = { contextToken: "original-context-token", displayLabel: "You", info: { configured: true, local: true, providerKey: "synthetic", hasConsent: true },
  chats: [{ id: chatId, createdAt: "2026-09-07T10:00:00.000Z" }] };
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
function render(token = props.contextToken) { harness.cursor = 0; harness.refCursor = 0; return OwnChatPanel({ ...props, contextToken: token }); }
function control(tree: ReactNode, type: string, label?: string) {
  const found = elements(tree).find(node => node.type === type && (label === undefined || text(node.props.children as ReactNode).includes(label)));
  if (!found) throw new Error("Expected client control");
  return found.props;
}
async function open(correction = false) {
  harness.fetch.mockResolvedValueOnce(Response.json({ chatId, scope: { kind: "self", displayLabel: "You" }, messages,
    ...(correction ? { correction: ownChatCorrection() } : {}) }));
  (control(render(), "button", "Conversation from").onClick as () => void)();
  await vi.waitFor(() => expect(text(render())).toContain("Earlier paraphrased claim"));
}
beforeEach(() => { harness.state = []; harness.refs = []; vi.clearAllMocks(); vi.stubGlobal("fetch", harness.fetch); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("own chat correction client contract", () => {
  it("reads historical messages unchanged with a visible notice and disabled continuation", async () => {
    await open(true);
    const tree = render();
    expect(text(tree)).toContain(OWN_CHAT_CORRECTION_NOTICE);
    expect(text(tree)).toContain(messages[0].content);
    expect(control(tree, "textarea").disabled).toBe(true);
    expect(control(tree, "button", "Send").disabled).toBe(true);
    expect(control(tree, "button", "New conversation").disabled).toBe(true);
    expect(harness.refresh).not.toHaveBeenCalled();
  });
  it("keeps history and the unsent question on an explicit correction response", async () => {
    await open();
    (control(render(), "textarea").onChange as (event: unknown) => void)({ target: { value: "Explain your earlier answer." } });
    harness.fetch.mockResolvedValueOnce(Response.json(ownChatCorrection(), { status: 409 }));
    (control(render(), "form").onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await vi.waitFor(() => expect(text(render())).toContain(OWN_CHAT_CORRECTION_NOTICE));
    const tree = render("new-nonce-same-projection");
    expect(text(tree)).toContain("Earlier paraphrased claim");
    expect(control(tree, "textarea").value).toBe("Explain your earlier answer.");
    expect(control(tree, "button", "Send").disabled).toBe(true);
    expect(text(tree)).not.toContain("Review your Copilot settings before asking again");
    expect(harness.fetch).toHaveBeenCalledTimes(2);
    expect(harness.refresh).not.toHaveBeenCalled();
    (control(tree, "form").onSubmit as (event: unknown) => void)({ preventDefault() {} });
    expect(harness.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([403, 409])("retains the existing fail-closed permission behavior for an unrelated %s response", async status => {
    await open();
    (control(render(), "textarea").onChange as (event: unknown) => void)({ target: { value: "Explain this." } });
    harness.fetch.mockResolvedValueOnce(Response.json({ error: "copilot_unavailable" }, { status }));
    (control(render(), "form").onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await vi.waitFor(() => expect(text(render())).toContain("Review your Copilot settings before asking again"));
    expect(text(render())).not.toContain("Earlier paraphrased claim");
    expect(text(render())).not.toContain(OWN_CHAT_CORRECTION_NOTICE);
    expect(harness.refresh).toHaveBeenCalledOnce();
  });
});
