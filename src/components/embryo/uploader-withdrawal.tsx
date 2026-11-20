"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type RefObject } from "react";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { EMBRYO_UPLOADER_WITHDRAWAL_COPY as COPY } from "@/copy/embryos/uploader-withdrawal";
import {
  requestEmbryoUploaderWithdrawal,
  type EmbryoUploaderWithdrawalView,
} from "@/lib/embryos/uploader-withdrawal-client";
import { WITHDRAWAL_START, withdrawalStep, type WithdrawalState } from "@/lib/uploads/own-upload-withdrawal-client";

/**
 * <EmbryoUploaderWithdrawal> — a non-parent uploader withdraws its permission
 * for an embryo upload (owner decision of 19 November 2026, "A non-parent
 * uploader's withdrawal for an embryo upload stops analysis and deletes, as
 * they signed"). Embryo upload is test mode only. On a finalised cohort's card
 * on /embryos it restricts the cohort; on /embryos/upload, before
 * finalisation, it deletes the draft. The page decides nothing: the database's
 * read gives the phase, and the confirmation says what happens in it.
 *
 * The request is api.consent-revoke for the uploader's own signature, sent
 * only from the open confirmation. Only 202 is a withdrawal, and only it shows
 * the receipt. A refusal committed nothing; any other answer, or none, cannot
 * say.
 */
export function EmbryoUploaderWithdrawal({ view }: { view: EmbryoUploaderWithdrawalView | null }) {
  const router = useRouter();
  const csrf = useCsrf("api.consent-revoke");
  const [state, dispatch] = useReducer(withdrawalStep, WITHDRAWAL_START);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  // The phase of the request this control sent, so its receipt survives the page dropping the view.
  const [sentPhase, setSentPhase] = useState<"cohort" | "draft">("cohort");

  useEffect(() => {
    if (state.phase === "confirming") dialogHeading.current?.focus();
    if (state.phase === "done") receiptHeading.current?.focus();
  }, [state.phase]);

  async function confirm() {
    if (state.phase !== "confirming" || !view || view.readiness === "unavailable" || !view.nonce) return;
    const phase = view.readiness;
    setSentPhase(phase);
    dispatch({ type: "send" });
    const outcome = await requestEmbryoUploaderWithdrawal(csrf, view.signatureId, view.nonce);
    dispatch({ type: "answered", outcome });
    // A restricted cohort is no longer listed, so rendering /embryos again
    // would take its card, and this receipt, away: after a cohort's
    // withdrawal the receipt stays until the person leaves. The upload page
    // renders the control outside its stage, so it renders again after any
    // answer, as it does after a refusal or an unknown answer anywhere.
    if (outcome !== "withdrawn" || phase === "draft") router.refresh();
  }

  return (
    <EmbryoUploaderWithdrawalPanel view={view} state={state} receiptPhase={sentPhase} dialogHeading={dialogHeading}
      receiptHeading={receiptHeading} onOpen={() => dispatch({ type: "open" })}
      onCancel={() => dispatch({ type: "cancel" })} onConfirm={() => void confirm()} />
  );
}

/** What the control shows for one view and one step. Pure: it holds no state and sends nothing. */
export function EmbryoUploaderWithdrawalPanel({ view, state, receiptPhase = "cohort", dialogHeading, receiptHeading, onOpen,
  onCancel, onConfirm }: {
  view: EmbryoUploaderWithdrawalView | null;
  state: WithdrawalState;
  receiptPhase?: "cohort" | "draft";
  dialogHeading?: RefObject<HTMLHeadingElement | null>;
  receiptHeading?: RefObject<HTMLHeadingElement | null>;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!view && state.phase !== "done" && !state.failure) return null;
  const phase = view && view.readiness !== "unavailable" ? view.readiness : null;
  const sendable = phase !== null && Boolean(view?.nonce);
  const sending = state.phase === "sending";
  const ids = `embryo-uploader-withdrawal-${view?.signatureId ?? "sent"}`;
  return (
    <section data-slot="embryo-uploader-withdrawal" data-phase={phase ?? undefined} aria-labelledby={`${ids}-heading`}
      className="rec-stack border-t border-line pt-4">
      <h3 id={`${ids}-heading`} className="label text-ink">{COPY.heading}</h3>
      {state.phase === "done" ? (
        <div role="status" data-slot="embryo-uploader-withdrawal-receipt" className="rec-stack-sm">
          <p ref={receiptHeading} tabIndex={-1} className="text-base font-medium text-ink">{COPY.receiptHeading}</p>
          <p className="max-w-measure text-sm leading-relaxed text-ink">
            {receiptPhase === "draft" ? COPY.draftReceiptBody : COPY.cohortReceiptBody}
          </p>
        </div>
      ) : (
        <>
          {phase ? (
            <p className="max-w-measure text-sm leading-relaxed text-ink">
              {phase === "draft" ? COPY.draftSummary : COPY.cohortSummary}
            </p>
          ) : null}
          {state.failure ? (
            <p role="alert" data-slot="embryo-uploader-withdrawal-failure" className="text-sm text-danger">
              {state.failure === "refused" ? COPY.refusedStatus : COPY.uncertainStatus}
            </p>
          ) : null}
          {view && view.readiness === "unavailable" ? (
            <p data-slot="embryo-uploader-withdrawal-reason" className="max-w-measure text-sm text-ink-muted">
              {COPY.unavailableStatus}
            </p>
          ) : null}
          {sendable && state.phase === "idle" ? (
            <div>
              <Button type="button" variant="outline" data-testid="embryo-uploader-withdrawal"
                className="h-auto whitespace-normal text-left" onClick={onOpen}>
                {COPY.withdrawButton}
              </Button>
            </div>
          ) : null}
          {sendable && (state.phase === "confirming" || sending) ? (
            <div role="alertdialog" aria-labelledby={`${ids}-confirm-heading`} aria-describedby={`${ids}-confirm-irreversible`}
              data-slot="embryo-uploader-withdrawal-confirm" className="surface surface-pad max-w-measure space-y-3 border-danger">
              <h4 id={`${ids}-confirm-heading`} ref={dialogHeading} tabIndex={-1} className="title text-ink">
                {phase === "draft" ? COPY.draftConfirmHeading : COPY.cohortConfirmHeading}
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {(phase === "draft" ? COPY.draftDeletes : COPY.cohortDeletes).map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="text-sm leading-relaxed text-ink-muted">{COPY.noRole}</p>
              <p id={`${ids}-confirm-irreversible`} className="text-sm font-medium text-ink">{COPY.irreversible}</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="destructive" data-testid="embryo-uploader-withdrawal-confirm"
                  disabled={sending} onClick={onConfirm}>
                  {sending ? COPY.working : COPY.confirmButton}
                </Button>
                <Button type="button" variant="outline" disabled={sending} onClick={onCancel}>
                  {COPY.cancelButton}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
