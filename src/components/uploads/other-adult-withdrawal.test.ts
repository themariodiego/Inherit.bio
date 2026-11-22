import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { OTHER_ADULT_HAND_OVER_COPY as HAND_OVER, OTHER_ADULT_WITHDRAWAL_COPY as COPY } from "@/copy/upload/other-adult-withdrawal";
import type { OtherAdultTarget, OtherAdultWithdrawalView } from "@/lib/uploads/other-adult-upload";
import { WITHDRAWAL_START, type WithdrawalState } from "@/lib/uploads/own-upload-withdrawal-client";
import { OtherAdultWithdrawal, OtherAdultWithdrawalPanel } from "./other-adult-withdrawal";
import { OtherAdultUploadCard } from "./other-adult-upload-card";

/**
 * The control that withdraws an uploader's permission for another adult's
 * file (owner decision of 19 November 2026, "An uploader's withdrawal for
 * another adult's file deletes it, unless that adult holds the record
 * themselves"), on that person's card on /files/upload. Rendered here for
 * every view and step, so every selector and sentence
 * `e2e/other-adult-upload-withdrawal.spec.ts` relies on is pinned before a
 * browser runs, and its buttons are followed to the handler each one calls.
 */

const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NAME = "Synthetic Relative";
const NONCE = `${Date.now() + 60_000}.${"n".repeat(43)}.${"0".repeat(64)}`;
const view = (readiness: OtherAdultWithdrawalView["readiness"]): OtherAdultWithdrawalView =>
  ({ readiness, nonce: readiness === "ready" || readiness === "hand-over" ? NONCE : null });
const noop = () => {};
const render = (v: OtherAdultWithdrawalView | undefined, state: WithdrawalState = WITHDRAWAL_START) =>
  renderToStaticMarkup(createElement(OtherAdultWithdrawalPanel, { subjectId: SUBJECT, name: NAME, view: v, state,
    onOpen: noop, onCancel: noop, onConfirm: noop }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function wiring(v: OtherAdultWithdrawalView | undefined, state: WithdrawalState) {
  const calls: string[] = [];
  const tree = OtherAdultWithdrawalPanel({ subjectId: SUBJECT, name: NAME, view: v, state, onOpen: () => calls.push("open"),
    onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("confirm") });
  const byTestId = (id: string) => elements(tree).filter(element => element.props["data-testid"] === id);
  return { calls, byTestId, tree };
}

describe("the other-adult withdrawal control", () => {
  it("renders nothing without a live permission on a confirmed record", () => {
    expect(render(undefined)).toBe("");
    expect(renderToStaticMarkup(createElement(OtherAdultWithdrawal, { subjectId: SUBJECT, name: NAME, view: undefined }))).toBe("");
  });

  it("says what withdrawing does before any click, and offers only the trigger", () => {
    const html = render(view("ready"));
    expect(html).toContain('data-slot="other-adult-withdrawal"');
    expect(text(html)).toContain(COPY.heading);
    expect(text(html)).toContain(COPY.summary(NAME));
    expect(html).toMatch(new RegExp(`<button[^>]*data-testid="other-adult-withdrawal"[^>]*>${COPY.withdrawButton}</button>`, "u"));
    expect(html).not.toContain('data-testid="other-adult-withdrawal-confirm"');
    expect(html).not.toContain("alertdialog");
    expect(html).not.toContain(NONCE);
  });

  it("opens the confirmation from the trigger, and only the confirmation's button sends", () => {
    const idle = wiring(view("ready"), WITHDRAWAL_START);
    const [trigger] = idle.byTestId("other-adult-withdrawal");
    expect(trigger?.props.variant).toBe("outline");
    (trigger!.props.onClick as () => void)();
    expect(idle.calls).toEqual(["open"]);
    expect(idle.byTestId("other-adult-withdrawal-confirm")).toEqual([]);

    const open = wiring(view("ready"), { phase: "confirming", failure: null });
    expect(open.byTestId("other-adult-withdrawal")).toEqual([]);
    const [confirm] = open.byTestId("other-adult-withdrawal-confirm");
    expect(confirm?.props.variant).toBe("destructive");
    (confirm!.props.onClick as () => void)();
    expect(open.calls).toEqual(["confirm"]);
    const cancel = elements(open.tree).find(element => element.props.children === COPY.cancelButton);
    (cancel!.props.onClick as () => void)();
    expect(open.calls).toEqual(["confirm", "cancel"]);
  });

  it("says in the confirmation, for this record, what is deleted and that the person is told", () => {
    const html = render(view("ready"), { phase: "confirming", failure: null });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-slot="other-adult-withdrawal-confirm"');
    for (const line of [COPY.confirmHeading(NAME), ...COPY.deletes(NAME), COPY.notice(NAME), COPY.irreversible,
      COPY.confirmButton, COPY.cancelButton]) {
      expect(text(html)).toContain(line);
    }
  });

  it("offers no request for a record its person holds with their own account, and says so", () => {
    const html = render(view("account-held"));
    expect(text(html)).toContain(COPY.accountHeldStatus(NAME));
    expect(html).toContain('data-slot="other-adult-withdrawal-reason"');
    expect(text(html)).not.toContain(COPY.summary(NAME));
    expect(html).not.toContain("<button");
    // Plain text read at render: the card's own status line stays its one status.
    expect(html).not.toContain('role="status"');
    expect(render(view("account-held"), { phase: "confirming", failure: null })).not.toContain("<button");
  });

  // 20261122100000 (owner decision of 22 November 2026): once the transfer is
  // open, the same record reads hand-over, and the withdrawal hands it over.
  it("offers the hand-over for a record its person holds, once the transfer is open, in its own words", () => {
    const idle = render(view("hand-over"));
    expect(text(idle)).toContain(HAND_OVER.summary(NAME));
    expect(text(idle)).not.toContain(COPY.summary(NAME));
    expect(text(idle)).not.toContain(COPY.accountHeldStatus(NAME));
    expect(idle).not.toContain('data-slot="other-adult-withdrawal-reason"');
    expect(idle).toMatch(new RegExp(`<button[^>]*data-testid="other-adult-withdrawal"[^>]*>${COPY.withdrawButton}</button>`, "u"));
    const open = render(view("hand-over"), { phase: "confirming", failure: null });
    for (const line of [COPY.confirmHeading(NAME), ...HAND_OVER.moves(NAME), HAND_OVER.notice(NAME), COPY.irreversible,
      HAND_OVER.confirmButton, COPY.cancelButton]) {
      expect(text(open)).toContain(line);
    }
    for (const line of [...COPY.deletes(NAME), COPY.notice(NAME), COPY.confirmButton]) expect(text(open)).not.toContain(line);
    const wired = wiring(view("hand-over"), { phase: "confirming", failure: null });
    const [confirm] = wired.byTestId("other-adult-withdrawal-confirm");
    expect(confirm?.props.variant).toBe("destructive");
    (confirm!.props.onClick as () => void)();
    expect(wired.calls).toEqual(["confirm"]);
    const done = render(view("hand-over"), { phase: "done", failure: null });
    expect(text(done)).toContain(COPY.receiptHeading);
    expect(text(done)).toContain(HAND_OVER.receiptBody(NAME));
    expect(text(done)).not.toContain(COPY.receiptBody(NAME));
    expect(text(render(view("hand-over"), { phase: "idle", failure: "uncertain" }))).toContain(HAND_OVER.uncertainStatus);
    expect(text(render(view("hand-over"), { phase: "idle", failure: "refused" }))).toContain(COPY.refusedStatus);
  });

  it("says why it cannot run, and offers no request, while the database would refuse it", () => {
    for (const [readiness, line] of [["unsupported", COPY.unsupportedStatus], ["unavailable", COPY.unavailableStatus]] as const) {
      const html = render(view(readiness));
      expect(text(html), readiness).toContain(line);
      expect(html).not.toContain("<button");
      expect(render(view(readiness), { phase: "confirming", failure: null })).not.toContain("<button");
    }
  });

  it("holds both buttons while the request is in flight", () => {
    const { byTestId, tree } = wiring(view("ready"), { phase: "sending", failure: null });
    expect(byTestId("other-adult-withdrawal-confirm")[0]?.props.disabled).toBe(true);
    expect(byTestId("other-adult-withdrawal-confirm")[0]?.props.children).toBe(COPY.working);
    expect(elements(tree).find(element => element.props.children === COPY.cancelButton)?.props.disabled).toBe(true);
  });

  it("shows the receipt only after a withdrawal, and a refusal or an unknown answer never as one", () => {
    const done = render(view("ready"), { phase: "done", failure: null });
    expect(done).toContain('data-slot="other-adult-withdrawal-receipt"');
    expect(text(done)).toContain(COPY.receiptHeading);
    expect(text(done)).toContain(COPY.receiptBody(NAME));
    expect(done).not.toContain('data-testid="other-adult-withdrawal');
    const refused = render(view("ready"), { phase: "idle", failure: "refused" });
    expect(text(refused)).toContain(COPY.refusedStatus);
    expect(refused).toContain('role="alert"');
    expect(refused).not.toContain(COPY.receiptHeading);
    const unknown = render(view("ready"), { phase: "idle", failure: "uncertain" });
    expect(text(unknown)).toContain(COPY.uncertainStatus);
    expect(unknown).not.toContain(COPY.receiptHeading);
  });
});

describe("the person's card carries it", () => {
  const target = (state: OtherAdultTarget["state"], withdrawal?: OtherAdultWithdrawalView): OtherAdultTarget => ({
    subjectId: SUBJECT, label: NAME, requestedAt: "2026-11-01T10:00:00Z", answerBy: null, state, signed: true,
    latest: state === "pending" ? { state: "pending", addedOn: "2026-11-02T10:00:00Z", deleteBy: "2026-12-02T10:00:00Z", confirmedOn: null }
      : null, ...(withdrawal ? { withdrawal } : {}) });
  const card = (t: OtherAdultTarget) => renderToStaticMarkup(createElement(OtherAdultUploadCard, { target: t }));

  it("on a confirmed record, ready or with a file waiting, and nowhere without the server's view", () => {
    for (const state of ["ready", "pending"] as const) {
      expect(card(target(state, view("ready"))), state).toContain('data-testid="other-adult-withdrawal"');
      expect(card(target(state)), state).not.toContain('data-slot="other-adult-withdrawal"');
    }
    expect(card(target("awaiting-signature", view("ready")))).not.toContain('data-slot="other-adult-withdrawal"');
  });

  it("is prepared by the server and rendered by the card, which the upload page renders", () => {
    expect(readFileSync("src/lib/uploads/other-adult-upload-server.ts", "utf8"))
      .toContain("const withdrawal = await prepareOtherAdultWithdrawal(admin, actor, target);");
    expect(readFileSync("src/components/uploads/other-adult-upload-card.tsx", "utf8"))
      .toContain("view={target.withdrawal} onWithdrawn={() => setWithdrawn(true)} />");
  });
});
