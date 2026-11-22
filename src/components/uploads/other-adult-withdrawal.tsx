"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, type RefObject } from "react";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { OTHER_ADULT_HAND_OVER_COPY as HAND_OVER, OTHER_ADULT_WITHDRAWAL_COPY as COPY } from "@/copy/upload/other-adult-withdrawal";
import type { OtherAdultWithdrawalView } from "@/lib/uploads/other-adult-upload";
import {
  WITHDRAWAL_START,
  requestOwnUploadWithdrawal,
  withdrawalStep,
  type WithdrawalState,
} from "@/lib/uploads/own-upload-withdrawal-client";

/**
 * <OtherAdultWithdrawal> — the uploader withdraws its permission for another
 * adult's DNA file, on that person's card on the upload page (owner decision
 * of 19 November 2026, "An uploader's withdrawal for another adult's file
 * deletes it, unless that adult holds the record themselves"). Path B is test
 * mode only; the section that renders the card is closed everywhere else.
 *
 * The page renders the view (`prepareOtherAdultWithdrawal`): nothing unless
 * the uploader holds a live permission on a confirmed record, and the request
 * only when the database says this record's withdrawal can run now, which is
 * the server's answer for THIS record: a person who holds it with their own
 * account reads `account-held` while the transfer is closed, and the control
 * then says it cannot run here and offers nothing. Once the transfer is open
 * the same record reads `hand-over` (owner decision of 22 November 2026, "An
 * uploader's withdrawal hands a record its adult holds to that adult"): the
 * confirmation then says the record and the files they confirmed become
 * theirs and the rest is deleted. Otherwise the confirmation names what is
 * deleted and that the person is told, and only its button sends.
 *
 * The request is api.subject-delete for that record (`DELETE
 * /api/subjects/[id]` with the page's one-time code and the route's session
 * token), the same request the own-file withdrawal sends; the route takes an
 * uploader's request to `withdraw_other_adult_upload_v1`. Only 202 is a
 * withdrawal: the card then shows only the receipt, and the page is not
 * rendered again (the purged record would take the card and its receipt with
 * it). A refusal committed nothing; any other answer, or none, cannot say, so
 * it asks the person to look again; after either the page renders again,
 * with a fresh code.
 */
export function OtherAdultWithdrawal({ subjectId, name, view, onWithdrawn }: {
  subjectId: string; name: string; view: OtherAdultWithdrawalView | undefined;
  /** Called once the withdrawal is accepted, so the card can show only the receipt. */
  onWithdrawn?: () => void;
}) {
  const router = useRouter();
  const csrf = useCsrf("api.subject-delete");
  const [state, dispatch] = useReducer(withdrawalStep, WITHDRAWAL_START);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.phase === "confirming") dialogHeading.current?.focus();
    if (state.phase === "done") receiptHeading.current?.focus();
  }, [state.phase]);

  async function confirm() {
    // A request is sent only from the open confirmation, with a code the page rendered.
    if (state.phase !== "confirming" || !view || (view.readiness !== "ready" && view.readiness !== "hand-over")
      || !view.nonce) return;
    dispatch({ type: "send" });
    const outcome = await requestOwnUploadWithdrawal(csrf, subjectId, view.nonce, view.readiness === "hand-over");
    dispatch({ type: "answered", outcome });
    // The record is gone once the withdrawal is accepted, and the card with
    // it on the next render, so the receipt stays until the person leaves;
    // any other answer renders the page again, with a fresh code.
    if (outcome === "withdrawn") onWithdrawn?.();
    else router.refresh();
  }

  return (
    <OtherAdultWithdrawalPanel subjectId={subjectId} name={name} view={view} state={state} dialogHeading={dialogHeading}
      receiptHeading={receiptHeading} onOpen={() => dispatch({ type: "open" })}
      onCancel={() => dispatch({ type: "cancel" })} onConfirm={() => void confirm()} />
  );
}

/** What the control shows for one view and one step. Pure: it holds no state and sends nothing. */
export function OtherAdultWithdrawalPanel({ subjectId, name, view, state, dialogHeading, receiptHeading, onOpen, onCancel,
  onConfirm }: {
  subjectId: string;
  name: string;
  view: OtherAdultWithdrawalView | undefined;
  state: WithdrawalState;
  dialogHeading?: RefObject<HTMLHeadingElement | null>;
  receiptHeading?: RefObject<HTMLHeadingElement | null>;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Nothing is shown without a live permission, except the answer to a
  // request this control already sent.
  if (!view && state.phase !== "done" && !state.failure) return null;
  // 20261122100000: a record its person holds is handed to them, once the transfer is open.
  const handOver = view?.readiness === "hand-over";
  const sendable = (view?.readiness === "ready" || handOver) && Boolean(view?.nonce);
  const sending = state.phase === "sending";
  const ids = `other-adult-withdrawal-${subjectId}`;
  return (
    <section data-slot="other-adult-withdrawal" aria-labelledby={`${ids}-heading`} className="rec-stack border-t border-line pt-4">
      <h4 id={`${ids}-heading`} className="label text-ink">{COPY.heading}</h4>
      {state.phase === "done" ? (
        <div role="status" data-slot="other-adult-withdrawal-receipt" className="rec-stack-sm">
          <p ref={receiptHeading} tabIndex={-1} className="text-base font-medium text-ink">{COPY.receiptHeading}</p>
          <p className="max-w-measure text-sm leading-relaxed text-ink">
            {handOver ? HAND_OVER.receiptBody(name) : COPY.receiptBody(name)}
          </p>
        </div>
      ) : (
        <>
          {view && view.readiness !== "account-held" ? (
            <p className="max-w-measure text-sm leading-relaxed text-ink">
              {handOver ? HAND_OVER.summary(name) : COPY.summary(name)}
            </p>
          ) : null}
          {state.failure ? (
            <p role="alert" data-slot="other-adult-withdrawal-failure" className="text-sm text-danger">
              {state.failure === "not-now" ? HAND_OVER.notNowStatus : state.failure === "refused" ? COPY.refusedStatus
                : handOver ? HAND_OVER.uncertainStatus : COPY.uncertainStatus}
            </p>
          ) : null}
          {view && view.readiness !== "ready" && !handOver ? (
            // Read when the page renders, so plain text, not a live region:
            // the card's own status line stays the card's one status.
            <p data-slot="other-adult-withdrawal-reason" className="max-w-measure text-sm text-ink-muted">
              {view.readiness === "account-held" ? COPY.accountHeldStatus(name)
                : view.readiness === "unsupported" ? COPY.unsupportedStatus : COPY.unavailableStatus}
            </p>
          ) : null}
          {sendable && state.phase === "idle" ? (
            <div>
              <Button type="button" variant="outline" data-testid="other-adult-withdrawal"
                className="h-auto whitespace-normal text-left" onClick={onOpen}>
                {COPY.withdrawButton}
              </Button>
            </div>
          ) : null}
          {sendable && (state.phase === "confirming" || sending) ? (
            <div role="alertdialog" aria-labelledby={`${ids}-confirm-heading`} aria-describedby={`${ids}-confirm-irreversible`}
              data-slot="other-adult-withdrawal-confirm" className="surface surface-pad max-w-measure space-y-3 border-danger">
              <h5 id={`${ids}-confirm-heading`} ref={dialogHeading} tabIndex={-1} className="title text-ink">
                {COPY.confirmHeading(name)}
              </h5>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {(handOver ? HAND_OVER.moves(name) : COPY.deletes(name)).map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="text-sm leading-relaxed text-ink-muted">{handOver ? HAND_OVER.notice(name) : COPY.notice(name)}</p>
              <p id={`${ids}-confirm-irreversible`} className="text-sm font-medium text-ink">{COPY.irreversible}</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="destructive" data-testid="other-adult-withdrawal-confirm"
                  disabled={sending} onClick={onConfirm}>
                  {sending ? COPY.working : handOver ? HAND_OVER.confirmButton : COPY.confirmButton}
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
