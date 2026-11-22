import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/copilot/s-{subject}` for one other adult's record, the page's states:
 * each renders its own slot and nothing past it. Only the ready state holds
 * a context token, a composer or a conversation; the unavailable page is the
 * registered projection, identical for every person; the thread header (the
 * h1) names the one person the thread reads (brief §8.6).
 */
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/copilot/subject-chat", () => ({ prepareSubjectCopilotChat: mocks.prepare }));
vi.mock("@/components/chat/own-chat-panel", () => ({ OwnChatPanel: () => null }));
vi.mock("@/components/chat/group-scope-pages", () => ({ LocalTransportUnavailable: () => null }));
vi.mock("@/components/family/result-gate", () => ({ ResultGate: () => null }));
import { SubjectCopilotPage } from "./subject-scope-page";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import { LocalTransportUnavailable } from "@/components/chat/group-scope-pages";
import { ResultGate } from "@/components/family/result-gate";
import { subjectHeldText, subjectPermissionMissingNote, subjectScopeHeading, subjectThreadHint } from "@/copy/copilot/subject-scope";

const SUBJECT = "83000000-0000-4000-8000-00000000000b";
const page = () => SubjectCopilotPage({ subjectId: SUBJECT });
function all(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...all(node.props.children)];
}
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join("")
  : typeof node === "string" || typeof node === "number" ? String(node)
  : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
const slot = (tree: ReactNode) => all(tree).map(element => (element.props as { "data-slot"?: string })["data-slot"]).find(Boolean);

beforeEach(() => vi.clearAllMocks());

describe("the one-record Copilot page", () => {
  it("is the same 404 as an unknown id when there is no relationship", async () => {
    mocks.prepare.mockResolvedValue(null);
    await expect(page()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("off an attested same-host model is the registered unavailable page and nothing else", async () => {
    mocks.prepare.mockResolvedValue({ kind: "transport_unavailable" });
    const tree = await page();
    expect(isValidElement(tree) && tree.type).toBe(LocalTransportUnavailable);
  });

  it.each([
    [{ kind: "jurisdiction_unavailable", copy: "Not available here.", displayLabel: "Bea" }, "copilot-subject-jurisdiction", "Not available here."],
    [{ kind: "provider_required", displayLabel: "Bea" }, "copilot-subject-provider-required", "Set Copilot to a model on this computer"],
    [{ kind: "permission_missing", displayLabel: "Bea" }, "copilot-subject-permission-missing", subjectPermissionMissingNote("Bea")],
    [{ kind: "held", displayLabel: "Bea" }, "copilot-subject-held", subjectHeldText("Bea")],
  ])("%o renders its own slot with no token, composer or conversation", async (view, expected, sentence) => {
    mocks.prepare.mockResolvedValue(view);
    const tree = await page();
    expect(slot(tree)).toBe(expected);
    expect(text(tree)).toContain(sentence);
    expect(text(tree)).toContain(subjectScopeHeading("Bea"));
    expect(all(tree).some(element => element.type === OwnChatPanel || element.type === ResultGate)).toBe(false);
    // A hold says nothing about why.
    if (view.kind === "held") expect(text(tree)).toBe(`Copilot${subjectScopeHeading("Bea")}${subjectHeldText("Bea")}`);
  });

  it("asks for the Tier-2 acknowledgement before any thread", async () => {
    mocks.prepare.mockResolvedValue({ kind: "gated", displayLabel: "Bea" });
    const tree = await page();
    expect(all(tree).some(element => element.type === ResultGate)).toBe(true);
    expect(all(tree).some(element => element.type === OwnChatPanel)).toBe(false);
  });

  it("ready: the thread header names the person, and the panel is the subject scope's with its one token", async () => {
    mocks.prepare.mockResolvedValue({ kind: "ready", displayLabel: "Bea", contextToken: "subject-token", contextHash: "h",
      providerInfo: { configured: true, local: true }, chats: [], layers: ["estimate"] });
    const tree = await page();
    expect(slot(tree)).toBe("copilot-subject");
    expect(all(tree).find(element => element.type === "h1") && text(all(tree).find(element => element.type === "h1"))).toBe(subjectScopeHeading("Bea"));
    const panel = all(tree).find(element => element.type === OwnChatPanel)!;
    expect(panel.props).toMatchObject({ contextToken: "subject-token", scopeKind: "subject", displayLabel: "Bea",
      threadHint: subjectThreadHint("Bea") });
  });
});
