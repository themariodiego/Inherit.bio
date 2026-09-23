import { isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("@/lib/copilot/own-chat", () => ({ prepareOwnCopilotChat: prepare }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "synthetic-account" } } }) } }) }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: async () => ({ id: "synthetic-subject", subjectClass: "self", displayLabel: "You" }) }));
vi.mock("@/components/chat/chat-panel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/chat/own-chat-panel", () => ({ OwnChatPanel: () => null }));
import ChatPage from "@/app/(app)/copilot/[scope]/page";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";

function panelKey(node: ReactNode): string | null | undefined {
  if (Array.isArray(node)) return node.map(panelKey).find(key => key !== undefined);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === OwnChatPanel ? node.key : panelKey(node.props.children);
}
it("preserves a blocked panel for a new nonce and remounts only for a changed authorized projection", async () => {
  const view = { kind: "ready", contextHash: "a".repeat(64), contextToken: "first-nonce", providerInfo: { configured: true }, chats: [] };
  prepare.mockResolvedValueOnce(view).mockResolvedValueOnce({ ...view, contextToken: "second-nonce" })
    .mockResolvedValueOnce({ ...view, contextHash: "b".repeat(64), contextToken: "third-nonce" });
  const props = { params: Promise.resolve({ scope: "me" }), searchParams: Promise.resolve({}) };
  const first = panelKey(await ChatPage(props)), same = panelKey(await ChatPage(props)), changed = panelKey(await ChatPage(props));
  expect(first).toBe(view.contextHash);
  expect(same).toBe(first);
  expect(changed).toBe("b".repeat(64));
});
