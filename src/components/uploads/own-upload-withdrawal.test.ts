import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { OWN_UPLOAD_WITHDRAWAL_COPY as COPY } from "@/copy/upload/withdrawal";
import { WITHDRAWAL_START, type OwnUploadWithdrawalView, type WithdrawalState } from "@/lib/uploads/own-upload-withdrawal-client";
import { OwnUploadWithdrawal, OwnUploadWithdrawalPanel } from "./own-upload-withdrawal";

/**
 * The control that withdraws the consent to store one's own DNA file (owner
 * decision of 19 November 2026), on /settings/consents and /files. Rendered
 * here for every view and step, so every selector and sentence
 * `e2e/own-upload-withdrawal.spec.ts` relies on is pinned before a browser
 * runs, and its buttons are followed to the handler each one calls.
 */

const SUBJECT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NONCE = `${Date.now() + 60_000}.${"n".repeat(43)}.${"0".repeat(64)}`;
const live = (readiness: "ready" | "processing" | "unsupported" | "unavailable"): OwnUploadWithdrawalView => ({
  kind: "live", subjectId: SUBJECT, signedAt: "2026-11-02T10:00:00Z", version: 1, readiness,
  nonce: readiness === "ready" ? NONCE : null });
const NONE: OwnUploadWithdrawalView = { kind: "none" };
const noop = () => {};
const render = (view: OwnUploadWithdrawalView, state: WithdrawalState = WITHDRAWAL_START) =>
  renderToStaticMarkup(createElement(OwnUploadWithdrawalPanel, { view, state, onOpen: noop, onCancel: noop, onConfirm: noop }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** Every element in the tree the pure panel returns, so a button's own handler can be followed. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function wiring(view: OwnUploadWithdrawalView, state: WithdrawalState) {
  const calls: string[] = [];
  const tree = OwnUploadWithdrawalPanel({ view, state, onOpen: () => calls.push("open"),
    onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("confirm") });
  const byTestId = (id: string) => elements(tree).filter(element => element.props["data-testid"] === id);
  return { calls, byTestId, tree };
}

describe("the own-upload withdrawal control", () => {
  it("renders nothing at all without a live upload consent", () => {
    expect(render(NONE)).toBe("");
    expect(renderToStaticMarkup(createElement(OwnUploadWithdrawal, { view: NONE }))).toBe("");
  });

  it("with a live consent, says what it is and what withdrawing does before any click, and offers only the trigger", () => {
    const html = render(live("ready"));
    expect(html).toContain('data-slot="own-upload-withdrawal"');
    expect(text(html)).toContain(COPY.heading);
    expect(text(html)).toContain(COPY.signedOn("2 November 2026"));
    expect(text(html)).toContain(COPY.summary);
    expect(html).toMatch(new RegExp(`<button[^>]*data-testid="own-upload-withdrawal"[^>]*>${COPY.withdrawButton}</button>`, "u"));
    expect(html).not.toContain('data-testid="own-upload-withdrawal-confirm"');
    expect(html).not.toContain("alertdialog");
    // The code is a header of the request, never markup.
    expect(html).not.toContain(NONCE);
    expect(renderToStaticMarkup(createElement(OwnUploadWithdrawal, { view: live("ready") }))).toBe(html);
  });

  it("opens the confirmation from the trigger, and only the confirmation's button sends", () => {
    const idle = wiring(live("ready"), WITHDRAWAL_START);
    const [trigger] = idle.byTestId("own-upload-withdrawal");
    expect(trigger?.props.variant).toBe("outline");
    (trigger!.props.onClick as () => void)();
    expect(idle.calls).toEqual(["open"]);
    expect(idle.byTestId("own-upload-withdrawal-confirm")).toEqual([]);

    const open = wiring(live("ready"), { phase: "confirming", failure: null });
    expect(open.byTestId("own-upload-withdrawal")).toEqual([]);
    const [confirm] = open.byTestId("own-upload-withdrawal-confirm");
    expect(confirm?.props.variant).toBe("destructive");
    expect(confirm?.props.disabled).toBe(false);
    (confirm!.props.onClick as () => void)();
    expect(open.calls).toEqual(["confirm"]);
    const cancel = elements(open.tree).find(element => element.props.children === COPY.cancelButton);
    (cancel!.props.onClick as () => void)();
    expect(open.calls).toEqual(["confirm", "cancel"]);
  });

  it("names in the confirmation what is deleted and what is kept, and that it cannot be undone", () => {
    const html = render(live("ready"), { phase: "confirming", failure: null });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-slot="own-upload-withdrawal-confirm"');
    for (const line of [COPY.confirmHeading, COPY.deletesHeading, ...COPY.deletes, COPY.keepsHeading, ...COPY.keeps,
      COPY.afterwards, COPY.irreversible, COPY.confirmButton, COPY.cancelButton]) {
      expect(text(html)).toContain(line);
    }
  });

  it("holds both buttons while the request is in flight", () => {
    const { byTestId, tree } = wiring(live("ready"), { phase: "sending", failure: null });
    expect(byTestId("own-upload-withdrawal-confirm")[0]?.props.disabled).toBe(true);
    expect(byTestId("own-upload-withdrawal-confirm")[0]?.props.children).toBe(COPY.working);
    expect(elements(tree).find(element => element.props.children === COPY.cancelButton)?.props.disabled).toBe(true);
  });

  it("shows the receipt only after a withdrawal, and keeps it when the page comes back without the consent", () => {
    for (const view of [live("ready"), NONE]) {
      const html = render(view, { phase: "done", failure: null });
      expect(html).toContain('data-slot="own-upload-withdrawal-receipt"');
      expect(html).toContain('role="status"');
      expect(text(html)).toContain(COPY.receiptHeading);
      expect(text(html)).toContain(COPY.receiptBody);
      expect(html).not.toContain('data-testid="own-upload-withdrawal');
    }
  });

  it("shows a refusal as a refusal and an unknown answer as unknown, never as the receipt", () => {
    const refused = render(live("ready"), { phase: "idle", failure: "refused" });
    expect(text(refused)).toContain(COPY.refusedStatus);
    expect(refused).toContain('role="alert"');
    expect(refused).not.toContain(COPY.receiptHeading);
    expect(refused).toContain('data-testid="own-upload-withdrawal"');
    const unknown = render(NONE, { phase: "idle", failure: "uncertain" });
    expect(text(unknown)).toContain(COPY.uncertainStatus);
    expect(unknown).not.toContain(COPY.receiptHeading);
    expect(unknown).not.toContain("<button");
  });

  it("says why it cannot run, and offers no request, while the database would refuse it", () => {
    for (const [readiness, line] of [["processing", COPY.processingStatus], ["unsupported", COPY.unsupportedStatus],
      ["unavailable", COPY.unavailableStatus]] as const) {
      const html = render(live(readiness));
      expect(text(html), readiness).toContain(line);
      expect(html).toContain('data-slot="own-upload-withdrawal-reason"');
      expect(html).not.toContain("<button");
      // Even an open confirmation cannot send without the page's code.
      expect(render(live(readiness), { phase: "confirming", failure: null })).not.toContain("<button");
    }
  });

  it("is the one control both pages render, from the one view the server prepares", () => {
    for (const page of ["src/app/(app)/settings/consents/page.tsx", "src/app/(app)/files/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source, page).toContain("<OwnUploadWithdrawal view={ownUpload} />");
      expect(source, page).toContain("prepareOwnUploadWithdrawal()");
    }
  });
});
