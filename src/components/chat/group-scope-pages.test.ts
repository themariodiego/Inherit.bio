import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/copilot/family`, the Family group scope's page: the Tier-2 gate (D-157).
 * Without this session's acknowledgement the page is the Family domain's one
 * gate, the same `ResultGate` `/family/[person]` renders, and nothing past
 * it: no member, conversation, context token or composer.
 */
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/copilot/family-chat", () => ({ prepareFamilyCopilotChat: mocks.prepare }));
vi.mock("@/lib/copilot/cohort-chat", () => ({ prepareCohortCopilotChat: vi.fn() }));
vi.mock("@/components/chat/own-chat-panel", () => ({ OwnChatPanel: () => null }));
vi.mock("@/components/family/result-gate", () => ({ ResultGate: () => null }));
import { FamilyCopilotPage } from "./group-scope-pages";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import { ResultGate } from "@/components/family/result-gate";
import { FAMILY_SCOPE_LABEL } from "@/copy/copilot/group-scopes";

function all(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...all(node.props.children)];
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("")
  : typeof node === "string" || typeof node === "number" ? String(node)
  : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
const slots = (tree: ReactNode) => all(tree).map(element => (element.props as { "data-slot"?: string })["data-slot"]).filter(Boolean);

beforeEach(() => vi.clearAllMocks());

describe("the Family group Copilot page", () => {
  it("without this session's acknowledgement is the Family Tier-2 gate under the page heading, and nothing past it", async () => {
    mocks.prepare.mockResolvedValue({ kind: "gated" });
    const tree = await FamilyCopilotPage();
    expect(slots(tree)).toEqual(["copilot-family-gated"]);
    expect(all(tree).filter(element => element.type === ResultGate)).toHaveLength(1);
    expect(all(tree).some(element => element.type === OwnChatPanel)).toBe(false);
    expect(text(all(tree).find(element => element.type === "h1"))).toBe(`Ask about ${FAMILY_SCOPE_LABEL}`);
    // The heading and the gate: no member, no lede, no note about sharing.
    expect(text(tree)).toBe(`CopilotAsk about ${FAMILY_SCOPE_LABEL}`);
  });

  it("with it, the thread as before, and no gate", async () => {
    mocks.prepare.mockResolvedValue({ kind: "ready", contextToken: "family-token", contextHash: "h",
      providerInfo: { configured: true, local: true }, chats: [], members: [{ displayLabel: "Bea", layers: ["estimate"] }] });
    const tree = await FamilyCopilotPage();
    expect(slots(tree)).toContain("copilot-family");
    expect(slots(tree)).toContain("copilot-family-members");
    expect(all(tree).some(element => element.type === ResultGate)).toBe(false);
    expect(all(tree).find(element => element.type === OwnChatPanel)?.props).toMatchObject({ contextToken: "family-token", scopeKind: "family" });
  });

  it.each([
    [{ kind: "jurisdiction_unavailable", copy: "Not available here." }, "copilot-family-jurisdiction"],
    [{ kind: "provider_required" }, "copilot-family-provider-required"],
  ])("%o comes before the gate and renders no gate", async (view, slot) => {
    mocks.prepare.mockResolvedValue(view);
    const tree = await FamilyCopilotPage();
    expect(slots(tree)).toEqual([slot]);
    expect(all(tree).some(element => element.type === ResultGate || element.type === OwnChatPanel)).toBe(false);
  });
});
