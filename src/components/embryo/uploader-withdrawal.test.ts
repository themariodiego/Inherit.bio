import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { EMBRYO_UPLOADER_WITHDRAWAL_COPY as COPY } from "@/copy/embryos/uploader-withdrawal";
import type { EmbryoUploaderWithdrawalView } from "@/lib/embryos/uploader-withdrawal-client";
import { WITHDRAWAL_START, type WithdrawalState } from "@/lib/uploads/own-upload-withdrawal-client";
import { EmbryoUploaderWithdrawal, EmbryoUploaderWithdrawalPanel } from "./uploader-withdrawal";

/**
 * A non-parent uploader's withdrawal of its permission for an embryo upload
 * (owner decision of 19 November 2026, "A non-parent uploader's withdrawal
 * for an embryo upload stops analysis and deletes, as they signed"), on a
 * finalised cohort's card on /embryos and on /embryos/upload before
 * finalisation. Every view and step is rendered here, so every selector and
 * sentence `e2e/embryo-uploader-withdrawal.spec.ts` relies on is pinned, and
 * each button is followed to the handler it calls.
 */

const SIGNATURE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NONCE = `${Date.now() + 60_000}.${"n".repeat(43)}.${"0".repeat(64)}`;
const view = (readiness: EmbryoUploaderWithdrawalView["readiness"]): EmbryoUploaderWithdrawalView =>
  ({ signatureId: SIGNATURE, readiness, nonce: readiness === "unavailable" ? null : NONCE });
const noop = () => {};
const render = (v: EmbryoUploaderWithdrawalView | null, state: WithdrawalState = WITHDRAWAL_START,
  receiptPhase: "cohort" | "draft" = "cohort") =>
  renderToStaticMarkup(createElement(EmbryoUploaderWithdrawalPanel, { view: v, state, receiptPhase, onOpen: noop,
    onCancel: noop, onConfirm: noop }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function wiring(v: EmbryoUploaderWithdrawalView | null, state: WithdrawalState) {
  const calls: string[] = [];
  const tree = EmbryoUploaderWithdrawalPanel({ view: v, state, onOpen: () => calls.push("open"),
    onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("confirm") });
  const byTestId = (id: string) => elements(tree).filter(element => element.props["data-testid"] === id);
  return { calls, byTestId, tree };
}

describe("the embryo uploader withdrawal control", () => {
  it("renders nothing for anyone who is not the cohort's or the draft's non-parent uploader", () => {
    expect(render(null)).toBe("");
    expect(renderToStaticMarkup(createElement(EmbryoUploaderWithdrawal, { view: null }))).toBe("");
  });

  it("says what withdrawing does in each phase before any click, and offers only the trigger", () => {
    for (const [phase, summary] of [["cohort", COPY.cohortSummary], ["draft", COPY.draftSummary]] as const) {
      const html = render(view(phase));
      expect(html).toContain('data-slot="embryo-uploader-withdrawal"');
      expect(html).toContain(`data-phase="${phase}"`);
      expect(text(html)).toContain(COPY.heading);
      expect(text(html)).toContain(summary);
      expect(html).toMatch(new RegExp(`<button[^>]*data-testid="embryo-uploader-withdrawal"[^>]*>${COPY.withdrawButton}</button>`, "u"));
      expect(html).not.toContain("alertdialog");
      expect(html).not.toContain(NONCE);
    }
  });

  it("opens the confirmation from the trigger, and only the confirmation's button sends", () => {
    const idle = wiring(view("cohort"), WITHDRAWAL_START);
    const [trigger] = idle.byTestId("embryo-uploader-withdrawal");
    (trigger!.props.onClick as () => void)();
    expect(idle.calls).toEqual(["open"]);
    expect(idle.byTestId("embryo-uploader-withdrawal-confirm")).toEqual([]);
    const open = wiring(view("cohort"), { phase: "confirming", failure: null });
    expect(open.byTestId("embryo-uploader-withdrawal")).toEqual([]);
    const [confirm] = open.byTestId("embryo-uploader-withdrawal-confirm");
    expect(confirm?.props.variant).toBe("destructive");
    (confirm!.props.onClick as () => void)();
    const cancel = elements(open.tree).find(element => element.props.children === COPY.cancelButton);
    (cancel!.props.onClick as () => void)();
    expect(open.calls).toEqual(["confirm", "cancel"]);
  });

  it("names what each phase deletes, that the parents are told after finalisation, and that it gives no parent role", () => {
    const cohort = text(render(view("cohort"), { phase: "confirming", failure: null }));
    for (const line of [COPY.cohortConfirmHeading, ...COPY.cohortDeletes, COPY.noRole, COPY.irreversible]) expect(cohort).toContain(line);
    expect(cohort).not.toContain(COPY.draftConfirmHeading);
    const draft = text(render(view("draft"), { phase: "confirming", failure: null }));
    for (const line of [COPY.draftConfirmHeading, ...COPY.draftDeletes, COPY.noRole, COPY.irreversible]) expect(draft).toContain(line);
    expect(draft).not.toContain(COPY.cohortDeletes[3]);
  });

  it("offers no request when the read failed, and says so", () => {
    const html = render(view("unavailable"));
    expect(text(html)).toContain(COPY.unavailableStatus);
    expect(html).toContain('data-slot="embryo-uploader-withdrawal-reason"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(render(view("unavailable"), { phase: "confirming", failure: null })).not.toContain("<button");
  });

  it("shows the receipt of the phase it sent only after a withdrawal, and keeps it when the view is gone", () => {
    for (const [phase, body] of [["cohort", COPY.cohortReceiptBody], ["draft", COPY.draftReceiptBody]] as const) {
      for (const v of [view(phase), null]) {
        const html = render(v, { phase: "done", failure: null }, phase);
        expect(html).toContain('data-slot="embryo-uploader-withdrawal-receipt"');
        expect(text(html)).toContain(COPY.receiptHeading);
        expect(text(html)).toContain(body);
        expect(html).not.toContain('data-testid="embryo-uploader-withdrawal');
      }
    }
    const refused = render(view("cohort"), { phase: "idle", failure: "refused" });
    expect(text(refused)).toContain(COPY.refusedStatus);
    expect(refused).not.toContain(COPY.receiptHeading);
    const unknown = render(null, { phase: "idle", failure: "uncertain" });
    expect(text(unknown)).toContain(COPY.uncertainStatus);
    expect(unknown).not.toContain("<button");
  });

  it("is rendered on the cohort card for the uploader and on the upload page outside its stage", () => {
    expect(readFileSync("src/components/embryo/cohort-card.tsx", "utf8"))
      .toContain("{uploaderWithdrawal ? <EmbryoUploaderWithdrawal view={uploaderWithdrawal} /> : null}");
    expect(readFileSync("src/app/(app)/embryos/page.tsx", "utf8"))
      .toContain("uploaderWithdrawal={uploaderWithdrawals.get(cohort.id) ?? null}");
    const upload = readFileSync("src/app/(app)/embryos/upload/page.tsx", "utf8");
    expect(upload).toContain("{built ? <EmbryoUploaderWithdrawal view={uploaderWithdrawal} /> : null}");
    expect(upload).toContain("const built = permits(decision) && embryoIngestBuilt();");
  });
});
