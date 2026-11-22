import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Execute the row's real Delete handler with retained hook state, without a
// DOM, application server or network, as src/components/chat/own-chat-panel.test.ts
// does. The browser journey is e2e/file-deletion.spec.ts.
const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0,
  refresh: vi.fn(), fetch: vi.fn(), confirm: vi.fn() }));
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
// The shell's rendered one-time X-Inherit-CSRF token for api.file-delete (G8.5).
const CSRF = vi.hoisted(() => `1800000000000.${"C".repeat(43)}.${"b".repeat(64)}`);
vi.mock("@/components/security/csrf-provider", async () => {
  const { csrfHandle } = await import("@/lib/security/session-csrf-client");
  return { useCsrf: () => csrfHandle(CSRF) };
});
import { FileRowActions } from "./file-row-actions";
import { fileDeletionError } from "@/copy/upload/file-deletion";

/**
 * The Files page row's Delete (api.file-delete; G8.5, 20 November 2026,
 * "where the register is stricter, engineering codes to it"): it sends the
 * one-time value the page rendered for this file in X-Inherit-Operation-Nonce,
 * with the route's token, only after the confirmation; and after any answer
 * the page renders again, so the row carries a fresh value and is usable
 * again, as the consent list and the withdrawal control recover.
 */
const FILE = "8e1d0000-0000-4000-8000-0000000000c1";
const RENDERED = `${Date.now() + 600_000}.${"r".repeat(43)}.${"1".repeat(64)}`;
const FRESH = `${Date.now() + 600_000}.${"f".repeat(43)}.${"2".repeat(64)}`;

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as Element, ...elements(node.props.children)];
}
function render(deleteNonce: string | null) {
  harness.cursor = 0;
  harness.refCursor = 0;
  return FileRowActions({ fileId: FILE, status: "stored", tier: 1, deleteNonce });
}
const deleteButton = (tree: ReactNode) => elements(tree).filter(node => node.type === "button" && node.props.children === "Delete");
async function clickDelete(deleteNonce: string | null) {
  const [button] = deleteButton(render(deleteNonce));
  await (button!.props.onClick as () => Promise<void>)();
}
const sent = () => harness.fetch.mock.calls.map(([url, init]) => ({ url, method: (init as RequestInit).method,
  headers: (init as RequestInit).headers as Record<string, string> }));
/** The row's alert, as the next render shows it. */
const shownError = () => harness.state[1];

beforeEach(() => {
  harness.state = []; harness.refs = [];
  vi.clearAllMocks();
  harness.confirm.mockReturnValue(true);
  vi.stubGlobal("fetch", harness.fetch);
  vi.stubGlobal("window", { confirm: harness.confirm });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the Files page row's Delete", () => {
  it("is offered only with the one-time value the page rendered for the file", () => {
    expect(deleteButton(render(RENDERED))).toHaveLength(1);
    expect(deleteButton(render(null))).toEqual([]);
    // The value is a header of the request, never part of the row.
    expect(JSON.stringify(elements(render(RENDERED)).map(node => Object.fromEntries(Object.entries(node.props)
      .filter(([, value]) => typeof value === "string"))))).not.toContain(RENDERED);
  });

  it("sends the page's value with the route's token, only after the confirmation, and renders the page again", async () => {
    harness.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    await clickDelete(RENDERED);
    expect(harness.confirm).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([{ url: `/api/files/${FILE}`, method: "DELETE",
      headers: { "X-Inherit-CSRF": CSRF, "X-Inherit-Operation-Nonce": RENDERED } }]);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(shownError()).toBeNull();
  });

  it("sends nothing when the person does not confirm", async () => {
    harness.confirm.mockReturnValue(false);
    await clickDelete(RENDERED);
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it("after a refused value says the existing sentence, renders the page again, and the next Delete sends the fresh value", async () => {
    harness.fetch.mockResolvedValueOnce(Response.json({ error: "request_forbidden" }, { status: 403 }));
    await clickDelete(RENDERED);
    expect(shownError()).toBe(fileDeletionError("request_forbidden"));
    expect(shownError()).toBe("Deletion did not finish. Please try Delete again. The file will stay listed until deletion is complete.");
    expect(harness.refresh, "the page renders again with a fresh value for the row").toHaveBeenCalledTimes(1);
    expect(harness.state[0], "the row is usable again").toBe(false);
    harness.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await clickDelete(FRESH);
    expect(sent().map(request => request.headers["X-Inherit-Operation-Nonce"])).toEqual([RENDERED, FRESH]);
    expect(shownError()).toBeNull();
  });

  it.each([
    [Response.json({ error: "file_delete_processing" }, { status: 409 }), "This file is still processing. It was not deleted."],
    [Response.json({ error: "file_delete_failed" }, { status: 503 }), fileDeletionError(null)],
  ] as const)("after any other answer that is not a deletion, also renders the page again for a fresh value", async (response, sentence) => {
    harness.fetch.mockResolvedValueOnce(response);
    await clickDelete(RENDERED);
    expect(shownError()).toBe(sentence);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.state[0]).toBe(false);
  });
});

/**
 * The row's Process (api.file-process). G8.5, 22 November 2026: the route
 * answers a signed-out request with authenticated-api-v1's JSON 401, not a
 * plain-text "Unauthorized", and the row, which shows a failed answer's body
 * as it is, shows the words it showed for that answer, so nothing a person
 * reads changes. Every other answer is shown as before.
 */
describe("the Files page row's Process", () => {
  async function clickProcess() {
    harness.cursor = 0;
    harness.refCursor = 0;
    const tree = FileRowActions({ fileId: FILE, status: "uploaded", tier: 1, deleteNonce: null });
    const [button] = elements(tree).filter(node => node.type === "button" && node.props.children === "Process");
    await (button!.props.onClick as () => Promise<void>)();
  }

  it.each([
    ["authenticated-api-v1's JSON 401", () => Response.json({ error: "unauthenticated" }, { status: 401 })],
    ["the plain-text 401 it replaced", () => new Response("Unauthorized", { status: 401 })],
  ] as const)("shows %s as the words the row showed before", async (_label, answer) => {
    harness.fetch.mockResolvedValueOnce(answer());
    await clickProcess();
    expect(sent()).toEqual([{ url: `/api/files/${FILE}/process`, method: "POST", headers: { "X-Inherit-CSRF": CSRF } }]);
    expect(shownError()).toBe("Unauthorized");
  });

  it.each([
    [409, () => new Response("This file is not ready for another processing run.", { status: 409 }), "This file is not ready for another processing run."],
    [403, () => Response.json({ error: "request_forbidden" }, { status: 403 }), '{"error":"request_forbidden"}'],
    [401, () => Response.json({ error: "other" }, { status: 401 }), '{"error":"other"}'],
    [500, () => new Response("", { status: 500 }), "Processing failed (500)"],
  ] as const)("shows any other failed %s answer as before", async (_status, answer, shown) => {
    harness.fetch.mockResolvedValueOnce(answer());
    await clickProcess();
    expect(shownError()).toBe(shown);
  });
});
