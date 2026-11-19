"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, type RefObject } from "react";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { OWN_UPLOAD_WITHDRAWAL_COPY as COPY } from "@/copy/upload/withdrawal";
import {
  WITHDRAWAL_START,
  requestOwnUploadWithdrawal,
  withdrawalStep,
  type OwnUploadWithdrawalView,
  type WithdrawalState,
} from "@/lib/uploads/own-upload-withdrawal-client";

/**
 * <OwnUploadWithdrawal> — withdrawing the consent to store one's own DNA
 * file (owner decision of 19 November 2026, "Withdrawing consent for a
 * person's own DNA file deletes the files and all made from them"). The same
 * control sits on Settings → Consents and on the Files page.
 *
 * The page renders the view (`prepareOwnUploadWithdrawal`): nothing at all
 * unless the account holds a live upload consent, and the request only when
 * the database says the emptying can run now; otherwise the reason. The
 * trigger is an outline button with its consequence written above it; only
 * the confirmation, which names what is deleted and what is kept, sends the
 * request, and only its button is destructive (the pattern of the family
 * Stop sharing control).
 *
 * The request is the self case of `api.subject-delete`
 * (`requestOwnUploadWithdrawal`). Only 202 is a withdrawal; the receipt then
 * stays in place while the page renders again without the consent. A refusal
 * committed nothing, so it says nothing was deleted; any other answer, or
 * none, cannot say that, so it asks the person to look again. After every
 * answer the page renders again, which brings a fresh code and the current
 * reason, if any.
 */
export function OwnUploadWithdrawal({ view }: { view: OwnUploadWithdrawalView }) {
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
    if (state.phase !== "confirming" || view.kind !== "live" || view.readiness !== "ready" || !view.nonce) return;
    dispatch({ type: "send" });
    const outcome = await requestOwnUploadWithdrawal(csrf, view.subjectId, view.nonce);
    dispatch({ type: "answered", outcome });
    router.refresh();
  }

  return (
    <OwnUploadWithdrawalPanel view={view} state={state} dialogHeading={dialogHeading} receiptHeading={receiptHeading}
      onOpen={() => dispatch({ type: "open" })} onCancel={() => dispatch({ type: "cancel" })}
      onConfirm={() => void confirm()} />
  );
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** What the control shows for one view and one step. Pure: it holds no state and sends nothing. */
export function OwnUploadWithdrawalPanel({ view, state, dialogHeading, receiptHeading, onOpen, onCancel, onConfirm }: {
  view: OwnUploadWithdrawalView;
  state: WithdrawalState;
  dialogHeading?: RefObject<HTMLHeadingElement | null>;
  receiptHeading?: RefObject<HTMLHeadingElement | null>;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const live = view.kind === "live" ? view : null;
  // Nothing is shown without a live consent, except the answer to a request
  // this control already sent: its receipt, or why it may not have worked.
  if (!live && state.phase !== "done" && !state.failure) return null;
  const sendable = live?.readiness === "ready" && Boolean(live.nonce);
  const sending = state.phase === "sending";
  return (
    <section data-slot="own-upload-withdrawal" aria-labelledby="own-upload-withdrawal-heading"
      className="surface rec-danger surface-pad rec-stack">
      <h2 id="own-upload-withdrawal-heading" className="title text-ink">{COPY.heading}</h2>
      {state.phase === "done" ? (
        <div role="status" data-slot="own-upload-withdrawal-receipt" className="rec-stack">
          <h3 ref={receiptHeading} tabIndex={-1} className="label text-ink">{COPY.receiptHeading}</h3>
          <p className="max-w-measure text-base leading-relaxed text-ink">{COPY.receiptBody}</p>
        </div>
      ) : (
        <>
          {live ? (
            <>
              <p className="max-w-measure text-sm leading-relaxed text-ink-muted">
                {COPY.signedOn(DATE.format(new Date(live.signedAt)))}
              </p>
              <p className="max-w-measure text-base leading-relaxed text-ink">{COPY.summary}</p>
            </>
          ) : null}
          {state.failure ? (
            <p role="alert" data-slot="own-upload-withdrawal-failure" className="text-sm text-danger">
              {state.failure === "refused" ? COPY.refusedStatus : COPY.uncertainStatus}
            </p>
          ) : null}
          {live && live.readiness !== "ready" ? (
            <p role="status" data-slot="own-upload-withdrawal-reason" className="max-w-measure text-sm text-ink-muted">
              {live.readiness === "processing" ? COPY.processingStatus
                : live.readiness === "unsupported" ? COPY.unsupportedStatus : COPY.unavailableStatus}
            </p>
          ) : null}
          {sendable && state.phase === "idle" ? (
            <div>
              <Button type="button" variant="outline" data-testid="own-upload-withdrawal"
                className="h-auto whitespace-normal text-left" onClick={onOpen}>
                {COPY.withdrawButton}
              </Button>
            </div>
          ) : null}
          {sendable && (state.phase === "confirming" || sending) ? (
            <div role="alertdialog" aria-labelledby="own-upload-withdrawal-confirm-heading"
              aria-describedby="own-upload-withdrawal-confirm-irreversible" data-slot="own-upload-withdrawal-confirm"
              className="surface surface-pad max-w-measure space-y-3 border-danger">
              <h3 id="own-upload-withdrawal-confirm-heading" ref={dialogHeading} tabIndex={-1} className="title text-ink">
                {COPY.confirmHeading}
              </h3>
              <h4 className="label text-ink">{COPY.deletesHeading}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {COPY.deletes.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <h4 className="label text-ink">{COPY.keepsHeading}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                {COPY.keeps.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="text-sm leading-relaxed text-ink-muted">{COPY.afterwards}</p>
              <p id="own-upload-withdrawal-confirm-irreversible" className="text-sm font-medium text-ink">
                {COPY.irreversible}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="destructive" data-testid="own-upload-withdrawal-confirm"
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
