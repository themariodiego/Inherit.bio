import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/copilot/[scope]` for a subject segment (G8.5, 24 October 2026): only a
 * self subject the account holds reaches the own chat and its context token.
 * Every other subject the account can resolve is refused with the
 * register's answer before any token is minted: a true non-self subject on a
 * runtime with no attested same-host model gets the registered unavailable
 * page, and everything else is the non-enumerating 404. The database, the
 * own chat and the panels are mocked; every value is synthetic.
 */
const ACCOUNT = vi.hoisted(() => "80000000-0000-4000-8000-0000000000a1");
const mocks = vi.hoisted(() => ({ subject: vi.fn(), prepare: vi.fn(), local: { allowed: false } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ACCOUNT } } }) } }) }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.subject }));
vi.mock("@/lib/copilot/own-chat", () => ({ prepareOwnCopilotChat: mocks.prepare }));
vi.mock("@/lib/copilot/model-endpoint", () => ({ modelRuntime: () => ({ localAllowed: mocks.local.allowed }) }));
vi.mock("@/components/chat/own-chat-panel", () => ({ OwnChatPanel: () => null }));
vi.mock("@/components/chat/group-scope-pages", () => ({ LocalTransportUnavailable: () => null, FamilyCopilotPage: () => null,
  CohortCopilotPage: () => null }));
import ChatPage from "@/app/(app)/copilot/[scope]/page";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import { LocalTransportUnavailable } from "@/components/chat/group-scope-pages";
import { copilotSubjectScope } from "./subject-scope";

const OTHER_ACCOUNT = "80000000-0000-4000-8000-0000000000b2";
const SUBJECT = "80000000-0000-4000-8000-0000000000c3";
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const subject = (subjectClass: string, subjectAccountId: string | null) => ({ id: SUBJECT, displayLabel: "Sam Example", subjectClass,
  subjectAccountId, ownerAccountId: ACCOUNT, lifecycle: "active", lifecycleRevision: 1, routeSegment: `s-${SUBJECT}`, dataSubjectId: SUBJECT });
const page = () => ChatPage({ params: Promise.resolve({ scope: `s-${SUBJECT}` }), searchParams: Promise.resolve({}) } as Parameters<typeof ChatPage>[0]);
function find(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) return node.some(child => find(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  return node.type === type || find(node.props.children, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.local.allowed = false;
  mocks.prepare.mockResolvedValue({ kind: "ready", contextHash: "a".repeat(64), contextToken: "synthetic-own-token",
    providerInfo: { configured: true, local: false, providerKey: "model.synthetic.invalid", model: "synthetic-model", hasConsent: true }, chats: [] });
});

describe("which subjects /copilot/[scope] opens a conversation for", () => {
  it("classifies each subject the account can resolve by the register's cases", () => {
    expect(copilotSubjectScope(ACCOUNT, { subjectClass: "self", subjectAccountId: ACCOUNT }, false)).toEqual({ kind: "own" });
    expect(copilotSubjectScope(ACCOUNT, { subjectClass: "self", subjectAccountId: ACCOUNT }, true)).toEqual({ kind: "own" });
    expect(copilotSubjectScope(ACCOUNT, { subjectClass: "self", subjectAccountId: OTHER_ACCOUNT }, true))
      .toEqual({ kind: "refused", case: "not-held" });
    for (const holder of [null, OTHER_ACCOUNT]) {
      expect(copilotSubjectScope(ACCOUNT, { subjectClass: "other_adult", subjectAccountId: holder }, false))
        .toEqual({ kind: "true-non-self-unavailable" });
      expect(copilotSubjectScope(ACCOUNT, { subjectClass: "other_adult", subjectAccountId: holder }, true))
        .toEqual({ kind: "refused", case: "adult-uploader-or-grantee" });
    }
    expect(copilotSubjectScope(ACCOUNT, { subjectClass: "other_adult", subjectAccountId: ACCOUNT }, true))
      .toEqual({ kind: "refused", case: "own-adult-subject" });
    for (const subjectClass of ["minor", "embryo"] as const) {
      for (const holder of [null, ACCOUNT]) {
        for (const local of [false, true]) {
          expect(copilotSubjectScope(ACCOUNT, { subjectClass, subjectAccountId: holder }, local)).toEqual({ kind: "refused", case: "no-subject-case" });
        }
      }
    }
  });

  it("opens the own chat, with its one context token, for a self subject the account holds", async () => {
    mocks.subject.mockResolvedValue(subject("self", ACCOUNT));
    const tree = await page();
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(SUBJECT);
    expect(find(tree, OwnChatPanel)).toBe(true);
  });

  it("refuses another adult the account uploaded or holds a grant for: the unavailable page here, with no token, subject or provider", async () => {
    for (const holder of [null, OTHER_ACCOUNT]) {
      mocks.subject.mockResolvedValue(subject("other_adult", holder));
      const tree = await page();
      expect(isValidElement(tree) && tree.type).toBe(LocalTransportUnavailable);
      expect(find(tree, OwnChatPanel)).toBe(false);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("answers every other subject the person may not ask about with the same 404, and mints nothing", async () => {
    const refused: Array<[string, string | null, boolean]> = [
      ["other_adult", null, true], ["other_adult", OTHER_ACCOUNT, true], ["other_adult", ACCOUNT, false], ["other_adult", ACCOUNT, true],
      ["minor", null, false], ["minor", ACCOUNT, true], ["embryo", null, false], ["embryo", ACCOUNT, true], ["self", OTHER_ACCOUNT, false],
    ];
    for (const [subjectClass, holder, local] of refused) {
      mocks.local.allowed = local;
      mocks.subject.mockResolvedValue(subject(subjectClass, holder));
      await expect(page(), `${subjectClass} held by ${holder} (local ${local})`).rejects.toMatchObject({ digest: NOT_FOUND });
    }
    mocks.subject.mockResolvedValue(null);
    await expect(page()).rejects.toMatchObject({ digest: NOT_FOUND });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
