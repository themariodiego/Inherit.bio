"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/components/embryo/format";
import { INGEST_REFUSALS } from "@/copy/upload/errors";
import { REQUEST_FAILED_STATUS, SIGN_BUTTON } from "@/copy/embryos/signing";
import {
  ACKNOWLEDGE_HEADING,
  ACKNOWLEDGE_LEDE,
  BACK_TO_EMBRYOS_LINK,
  CO_PARENT_SIGN_HEADING,
  CO_PARENT_SIGN_LEDE,
  EVIDENCE_REVIEW_UNAVAILABLE,
  FILE_COUNT_MISMATCH_STATUS,
  FILE_FINISHING_STATUS,
  FILE_INPUT_LABEL,
  FILE_NOTE,
  FILE_NOT_SENT_NOTE,
  FILE_QUESTION_HEADING,
  FILE_READING_STATUS,
  FILE_REFUSED_STATUS,
  FINALIZE_BUTTON,
  INVITATION_SENT_STATUS,
  INVITE_HEADING,
  INVITE_LEDE,
  OPEN_EMBRYOS_BUTTON,
  OWNER_SIGN_HEADING,
  OWNER_SIGN_LEDE,
  PROCESSING_HEADING,
  PROCESSING_SENTENCE,
  RECORD_KEY_CARDS_HEADING,
  RECORD_KEY_CARDS_NOTE,
  SEND_FILE_BUTTON,
  SEND_INVITATION_BUTTON,
  STILL_TO_COME_STATUS,
  UPLOAD_FAILED_SENTENCE,
  WAITING_HEADING,
  WAITING_SENTENCE,
  cardDateNote,
  draftDeadlineNote,
  fileSendingStatus,
  parentEmailLabel,
  stepStatus,
} from "@/copy/embryos/upload";
import type { CohortCard } from "@/lib/embryos/record-key-cards";
import type { UploadStageView } from "@/lib/embryos/upload-stage";
import { EMBRYO_INGEST_SESSION_LIMITS } from "@/lib/genome/ingest-limits";
import { UPLOAD_CSRF_HEADER, UploadTransportError, sendEmbryoFile, type UploadFailure, type UploadProgress, type UploadSession } from "@/lib/embryos/upload-transport";
import { route } from "@/lib/primary-routes";
import { ArtifactSigningForm } from "./signing-form";

/**
 * <UploadStage> — steps 3 to 5 of `/embryos/upload` and the checking panel
 * after them (design §2.2), rendered from the server's stage
 * (`loadUploadStage`). Every mutation posts to its registered route with the
 * one-time token the server minted for it, then asks the server for the
 * next stage (`router.refresh()`), so the page always shows what the
 * database says rather than what this browser hopes.
 *
 * Steps 4 and 5 are the exception: finalizing returns the Record Key Cards
 * and the upload session, which exist only in that one response, so the
 * acknowledgement, the cards and the file step stay in this component's
 * state until the file is sent. A reload after finalizing lands on the
 * server's `upload-left` notice instead.
 *
 * Nothing here ranks, orders or describes an embryo beyond its ordinal
 * label; the cards carry the key, the claim address and the date only.
 */
export function UploadStage({ view }: { view: Exclude<UploadStageView, { kind: "start" }> }) {
  const router = useRouter();
  const headingId = useId();
  const refresh = () => router.refresh();
  switch (view.kind) {
    case "owner-sign":
    case "co-parent-sign":
      return (
        <StageFrame step={3} slot={view.kind} headingId={headingId}
          heading={view.kind === "owner-sign" ? OWNER_SIGN_HEADING : CO_PARENT_SIGN_HEADING}
          lede={view.kind === "owner-sign" ? OWNER_SIGN_LEDE : CO_PARENT_SIGN_LEDE}>
          <ArtifactSigningForm draftId={view.draftId} artifacts={view.artifacts} submitLabel={SIGN_BUTTON} onSigned={refresh} />
        </StageFrame>
      );
    case "invite":
      return (
        <StageFrame step={3} slot="invite" headingId={headingId} heading={INVITE_HEADING} lede={INVITE_LEDE}>
          <InviteForm draftId={view.draftId} csrfTokens={view.csrfTokens} onSent={refresh} />
          <p className="text-sm text-ink-muted">{draftDeadlineNote(formatDate(view.expiresAt))}</p>
        </StageFrame>
      );
    case "waiting":
      return (
        <StageFrame step={3} slot="waiting" headingId={headingId} heading={WAITING_HEADING}>
          <p role="status" data-slot="waiting-status" className="max-w-prose text-base leading-relaxed text-ink">{WAITING_SENTENCE}</p>
          <p className="text-sm text-ink-muted">{draftDeadlineNote(formatDate(view.expiresAt))}</p>
          <BackToEmbryos />
        </StageFrame>
      );
    case "evidence-review-unavailable":
      return (
        <StageFrame step={3} slot="evidence-review-unavailable" headingId={headingId} heading={WAITING_HEADING}>
          <p role="status" className="max-w-prose text-base leading-relaxed text-ink">{EVIDENCE_REVIEW_UNAVAILABLE}</p>
          <BackToEmbryos />
        </StageFrame>
      );
    case "acknowledge":
      return <FinalizeAndSend view={view} />;
    case "processing":
      return <ProcessingPanel />;
  }
}

function StageFrame({ step, slot, heading, headingId, lede, children }: {
  step: 3 | 4 | 5;
  slot: string;
  heading: string;
  headingId: string;
  lede?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, [slot]);
  return (
    <section data-slot="upload-stage" data-stage={slot} data-step={step} aria-labelledby={headingId} className="space-y-6">
      <div className="space-y-1">
        <p role="status" data-slot="step-status" className="text-sm font-medium text-ink">{stepStatus(step)}</p>
        <p data-slot="still-to-come" className="text-sm leading-relaxed text-ink-muted">{STILL_TO_COME_STATUS[step]}</p>
      </div>
      <h2 id={headingId} ref={ref} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">{heading}</h2>
      {lede ? <p className="max-w-prose text-base leading-relaxed text-ink">{lede}</p> : null}
      {children}
    </section>
  );
}

function BackToEmbryos() {
  return (
    <p className="text-sm">
      <Link href={route("embryos.index")} className="inline-flex min-h-11 items-center underline underline-offset-2">{BACK_TO_EMBRYOS_LINK}</Link>
    </p>
  );
}

function InviteForm({ draftId, csrfTokens, onSent }: { draftId: string; csrfTokens: string[]; onSent: () => void }) {
  const [status, setStatus] = useState<"ready" | "pending" | "sent" | "failed">("ready");
  const ids = [useId(), useId()];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "pending") return;
    const form = new FormData(event.currentTarget);
    setStatus("pending");
    try {
      for (const [index, token] of csrfTokens.entries()) {
        const response = await fetch("/api/invitations", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", [UPLOAD_CSRF_HEADER]: token },
          body: JSON.stringify({ targetCohortDraftId: draftId, contactEmail: String(form.get(`contact-${index}`) ?? "").trim() }),
        });
        if (response.status !== 202) throw new Error("refused");
      }
      setStatus("sent");
      onSent();
    } catch {
      setStatus("failed");
    }
  }
  return (
    <form onSubmit={submit} data-slot="invite-form" className="space-y-4">
      {csrfTokens.map((_, index) => (
        <div key={index} className="space-y-2">
          <label htmlFor={ids[index]} className="block text-base font-medium text-ink">{parentEmailLabel(index, csrfTokens.length)}</label>
          <Input id={ids[index]} name={`contact-${index}`} type="email" autoComplete="off" required maxLength={254} className="max-w-md" />
        </div>
      ))}
      <Button type="submit" size="lg" disabled={status === "pending"}>{SEND_INVITATION_BUTTON}</Button>
      {status === "sent" ? <p role="status" className="max-w-prose text-sm text-ink">{INVITATION_SENT_STATUS}</p> : null}
      {status === "failed" ? <p role="alert" className="max-w-prose text-sm text-ink">{REQUEST_FAILED_STATUS}</p> : null}
    </form>
  );
}

type Finalized = { cards: CohortCard[]; session: UploadSession };
type FileState =
  | { phase: "choose"; problem: string | null }
  | { phase: "sending"; progress: UploadProgress }
  | { phase: "processing" }
  | { phase: "failed"; reason: string };

/** The sentence for a transport failure, from the refusal copy's one home. */
function failureSentence(failure: UploadFailure): string {
  switch (failure) {
    case "pdf": return INGEST_REFUSALS.pdf_not_data;
    case "not-a-vcf": return INGEST_REFUSALS.unrecognised_format;
    case "build-unknown": return INGEST_REFUSALS.build_unknown;
    case "too-large": return INGEST_REFUSALS.too_large(Math.round(EMBRYO_INGEST_SESSION_LIMITS.maximumUncompressedInputBytes / 1_000_000));
    case "sample-count": return FILE_COUNT_MISMATCH_STATUS;
    case "refused":
    case "network": return FILE_REFUSED_STATUS;
  }
}

function FinalizeAndSend({ view }: { view: Extract<UploadStageView, { kind: "acknowledge" }> }) {
  const headingId = useId();
  const [finalized, setFinalized] = useState<Finalized | null>(null);
  const [failed, setFailed] = useState(false);

  async function finalize(ids: Partial<Record<string, string>>) {
    const insurance = ids["disclosure.insurance-and-discrimination"] ?? view.signed["disclosure.insurance-and-discrimination"];
    const charter = ids["charter.future-person"] ?? view.signed["charter.future-person"];
    setFailed(false);
    const response = await fetch(route("api.embryo-cohorts"), {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cohortDraftId: view.draftId, insuranceAcknowledgementId: insurance,
        futurePersonCharterAcknowledgementId: charter, nonce: view.finalizeNonce }),
    });
    if (response.status !== 201) { setFailed(true); return; }
    const body = (await response.json()) as { upload_session: UploadSession; record_key_cards: CohortCard[] };
    setFinalized({ cards: body.record_key_cards, session: body.upload_session });
  }

  if (finalized) return <FileStep finalized={finalized} />;
  return (
    <StageFrame step={4} slot="acknowledge" headingId={headingId} heading={ACKNOWLEDGE_HEADING} lede={ACKNOWLEDGE_LEDE}>
      <ArtifactSigningForm draftId={view.draftId} artifacts={view.artifacts} submitLabel={FINALIZE_BUTTON} onSigned={finalize} />
      {failed ? <p role="alert" data-slot="finalize-failed" className="max-w-prose text-sm text-ink">{REQUEST_FAILED_STATUS}</p> : null}
    </StageFrame>
  );
}

function FileStep({ finalized }: { finalized: Finalized }) {
  const headingId = useId();
  const inputId = useId();
  const noteId = useId();
  const [state, setState] = useState<FileState>({ phase: "choose", problem: null });
  const file = useRef<HTMLInputElement>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen || state.phase === "sending") return;
    setState({ phase: "sending", progress: { phase: "reading" } });
    try {
      await sendEmbryoFile({ file: chosen, session: finalized.session,
        onProgress: (progress) => setState({ phase: "sending", progress }) });
      setState({ phase: "processing" });
    } catch (error) {
      const failure = error instanceof UploadTransportError ? error : new UploadTransportError("network", true);
      setState(failure.spent
        ? { phase: "failed", reason: failureSentence(failure.failure) }
        : { phase: "choose", problem: failureSentence(failure.failure) });
    }
  }

  if (state.phase === "processing") return <ProcessingPanel />;
  if (state.phase === "failed") {
    return (
      <section data-slot="upload-stage" data-stage="upload-failed" className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-5">
        <p role="alert" className="font-medium text-ink">{UPLOAD_FAILED_SENTENCE}</p>
        <p className="text-sm text-ink">{state.reason}</p>
        <BackToEmbryos />
      </section>
    );
  }
  const status = state.phase === "sending"
    ? state.progress.phase === "reading" ? FILE_READING_STATUS
      : state.progress.phase === "sending" ? fileSendingStatus(state.progress.part) : FILE_FINISHING_STATUS
    : null;
  return (
    <StageFrame step={5} slot="file" headingId={headingId} heading={FILE_QUESTION_HEADING}>
      {finalized.cards.length > 0 ? (
        <section data-slot="record-key-cards" aria-label={RECORD_KEY_CARDS_HEADING} className="space-y-3">
          <h3 className="text-base font-semibold text-ink">{RECORD_KEY_CARDS_HEADING}</h3>
          <p className="max-w-prose text-sm text-ink">{RECORD_KEY_CARDS_NOTE}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {finalized.cards.map((card) => (
              <li key={card.embryo_id} data-slot="record-key-card" className="space-y-1 rounded-2xl border border-line bg-card p-4">
                <p className="font-medium text-ink">{card.display_label}</p>
                <p className="break-all font-mono text-sm text-ink">{card.record_key}</p>
                <p className="break-all text-sm text-ink-muted">{card.claim_url}</p>
                <p className="text-sm text-ink-muted">
                  {cardDateNote(card.closing_date_words, card.closing_date_state === "provisional_until_terminal_ordinal_resolution")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form onSubmit={send} data-slot="file-form" className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-base font-medium text-ink">{FILE_INPUT_LABEL}</label>
          <input id={inputId} ref={file} type="file" name="file" required aria-describedby={noteId}
            disabled={state.phase === "sending"} className="block min-h-11 max-w-md text-sm text-ink" />
          <p id={noteId} className="max-w-prose text-sm text-ink-muted">{FILE_NOTE}</p>
        </div>
        <Button type="submit" size="lg" disabled={state.phase === "sending"}>{SEND_FILE_BUTTON}</Button>
        {status ? <p role="status" data-slot="file-status" className="text-sm text-ink">{status}</p> : null}
        {state.phase === "choose" && state.problem ? (
          <div role="alert" data-slot="file-problem" className="max-w-prose space-y-1 text-sm text-ink">
            <p>{state.problem}</p>
            <p className="text-ink-muted">{FILE_NOT_SENT_NOTE}</p>
          </div>
        ) : null}
      </form>
    </StageFrame>
  );
}

function ProcessingPanel() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section data-slot="upload-stage" data-stage="processing" className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-5">
      <h2 ref={ref} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">{PROCESSING_HEADING}</h2>
      <p role="status" className="text-base leading-relaxed text-ink">{PROCESSING_SENTENCE}</p>
      <Button asChild size="lg">
        <Link href={route("embryos.index")}>{OPEN_EMBRYOS_BUTTON}</Link>
      </Button>
    </section>
  );
}
