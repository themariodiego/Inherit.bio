"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/components/embryo/format";
import { INGEST_REFUSALS } from "@/copy/upload/errors";
import { REQUEST_FAILED_STATUS, SIGN_BUTTON } from "@/copy/embryos/signing";
import {
  ADD_MORE_EMBRYOS_BUTTON,
  UPLOAD_COMPLETE_HEADING,
  UPLOAD_COMPLETE_SENTENCE,
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
  FILE_RULES_BODY,
  FILE_FORMAT_BODY,
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
  SEND_INVITATION_PENDING_STATUS,
  STILL_TO_COME_STATUS,
  UPLOAD_STOPPED_SENTENCE,
  WAITING_HEADING,
  WAITING_SENTENCE,
  BUILD_OPTION_GRCH37,
  BUILD_OPTION_GRCH38,
  BUILD_OPTION_UNKNOWN,
  BUILD_QUESTION_HEADING,
  BUILD_QUESTION_LEDE,
  BUILD_UNKNOWN_NOTE,
  MAPPING_CHOOSE_OPTION,
  MAPPING_COLUMNS_BUTTON,
  MAPPING_COLUMNS_HEADING,
  MAPPING_COLUMNS_LEDE,
  MAPPING_FIELD_QUESTIONS,
  REQUEST_DATA_BUTTON,
  TABLE_UNMAPPED_STATUS,
  cardDateNote,
  draftDeadlineNote,
  fileSendingStatus,
  mappingColumnOption,
  parentEmailLabel,
  stepStatus,
} from "@/copy/embryos/upload";
import type { CohortCard } from "@/lib/embryos/record-key-cards";
import type { UploadStageView } from "@/lib/embryos/upload-stage";
import { EMBRYO_INGEST_SESSION_LIMITS } from "@/lib/genome/ingest-limits";
import { UPLOAD_CSRF_HEADER, UploadTransportError, sendEmbryoFile, type MappingAnswer, type MappingQuestion,
  type UploadFailure, type UploadProgress, type UploadSession } from "@/lib/embryos/upload-transport";
import { readUploadReceipt } from "@/lib/embryos/upload-receipt";
import { route } from "@/lib/primary-routes";
import { INITIAL_FLOW } from "@/lib/embryos/upload-flow";
import { COMPARE_THESE_LINK } from "@/copy/embryos/index";
import { UploadFlow } from "./upload-flow";
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
export function UploadStage({ view }: { view: Exclude<UploadStageView, { kind: "start" | "reauthenticate" }> }) {
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
    case "complete":
      return <UploadComplete view={view} />;
  }
}

/** The existing upload token starts another real draft only on an explicit
 * action. The complete screen itself reads or creates no derived result. */
export function UploadComplete({ view }: { view: Extract<UploadStageView, { kind: "complete" }> }) {
  const [adding, setAdding] = useState(false);
  if (adding) return <UploadFlow initial={{ ...INITIAL_FLOW, ingest: true }} draftCsrfToken={view.draftCsrfToken} />;
  return (
    <section data-slot="upload-complete" data-state="complete" data-cohort-id={view.cohortId} className="space-y-4">
      <h2 className="title text-ink">{UPLOAD_COMPLETE_HEADING}</h2>
      <p role="status" className="max-w-prose text-base leading-relaxed text-ink">{UPLOAD_COMPLETE_SENTENCE}</p>
      <p className="text-sm"><Link href={route("embryos.compare", { query: { cohort: view.cohortId } })} className="link-target quiet-link">{COMPARE_THESE_LINK}</Link></p>
      <BackToEmbryos />
      <Button type="button" onClick={() => setAdding(true)}>{ADD_MORE_EMBRYOS_BUTTON}</Button>
    </section>
  );
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
      onSent();
    }
  }
  return (
    <form onSubmit={submit} data-slot="invite-form" className="space-y-4">
      {csrfTokens.map((_, index) => (
        <div key={index} className="space-y-2">
          <label htmlFor={ids[index]} className="block text-base font-medium text-ink">{parentEmailLabel(index, csrfTokens.length)}</label>
          <Input id={ids[index]} name={`contact-${index}`} type="email" autoComplete="off" required maxLength={254} disabled={status === "pending"} className="max-w-md" />
        </div>
      ))}
      <Button type="submit" size="lg" disabled={status === "pending"}>{SEND_INVITATION_BUTTON}</Button>
      {status === "pending" ? <p role="status" aria-live="polite" data-state="processing" data-slot="invitation-status" className="max-w-prose text-sm text-ink">{SEND_INVITATION_PENDING_STATUS}</p> : null}
      {status === "sent" ? <p role="status" className="max-w-prose text-sm text-ink">{INVITATION_SENT_STATUS}</p> : null}
      {status === "failed" ? <p role="alert" className="max-w-prose text-sm text-ink">{REQUEST_FAILED_STATUS}</p> : null}
    </form>
  );
}

type Finalized = { cards: CohortCard[]; session: UploadSession };
type FileState =
  | { phase: "choose"; problem: string | null }
  | { phase: "sending"; progress: UploadProgress }
  | { phase: "question"; question: MappingQuestion; answer: (answer: MappingAnswer) => void }
  | { phase: "processing" }
  | { phase: "failed"; reason: string; letter: boolean };

/** The sentence for a transport failure, from the refusal copy's one home. */
function failureSentence(failure: UploadFailure): string {
  switch (failure) {
    case "pdf": return INGEST_REFUSALS.pdf_not_data;
    case "not-a-vcf": return INGEST_REFUSALS.unrecognised_format;
    case "build-unknown": return INGEST_REFUSALS.build_unknown;
    case "too-large": return INGEST_REFUSALS.too_large(Math.round(EMBRYO_INGEST_SESSION_LIMITS.maximumUncompressedInputBytes / 1_000_000));
    case "sample-count": return FILE_COUNT_MISMATCH_STATUS;
    case "table-unmapped": return TABLE_UNMAPPED_STATUS;
    case "refused":
    case "network": return FILE_REFUSED_STATUS;
  }
}

function FinalizeAndSend({ view }: { view: Extract<UploadStageView, { kind: "acknowledge" }> }) {
  const headingId = useId();
  const [finalized, setFinalized] = useState<Finalized | null>(null);
  const [failed, setFailed] = useState(false);
  const csrf = useCsrf("api.embryo-cohorts");

  async function finalize(ids: Partial<Record<string, string>>) {
    const insurance = ids["disclosure.insurance-and-discrimination"] ?? view.signed["disclosure.insurance-and-discrimination"];
    const charter = ids["charter.future-person"] ?? view.signed["charter.future-person"];
    setFailed(false);
    const response = await fetch(route("api.embryo-cohorts", {}), {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Inherit-CSRF": csrf.value() },
      body: JSON.stringify({ cohortDraftId: view.draftId, insuranceAcknowledgementId: insurance,
        futurePersonCharterAcknowledgementId: charter, nonce: view.finalizeNonce }),
    });
    csrf.accept(response);
    if (response.status !== 201) { setFailed(true); return; }
    try { setFinalized(readUploadReceipt(await response.json())); }
    catch { setFailed(true); }
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
        onProgress: (progress) => setState({ phase: "sending", progress }),
        // A laboratory table's question, asked on this screen; the upload
        // waits for the reader's answer and then carries on.
        decide: (question) => new Promise<MappingAnswer>((resolve) => {
          setState({ phase: "question", question, answer: (answer) => {
            setState({ phase: "sending", progress: { phase: "reading" } });
            resolve(answer);
          } });
        }) });
      setState({ phase: "processing" });
    } catch (error) {
      const failure = error instanceof UploadTransportError ? error : new UploadTransportError("network", true);
      setState(failure.spent
        ? { phase: "failed", reason: failureSentence(failure.failure),
          letter: failure.failure === "build-unknown" || failure.failure === "table-unmapped" }
        : { phase: "choose", problem: failureSentence(failure.failure) });
    }
  }

  if (state.phase === "processing") return <ProcessingPanel />;
  if (state.phase === "question") return <MappingQuestionPanel question={state.question} onAnswer={state.answer} />;
  if (state.phase === "failed") {
    return (
      <section data-slot="upload-stage" data-stage="upload-failed" className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-5">
        <p role="alert" className="font-medium text-ink">{UPLOAD_STOPPED_SENTENCE}</p>
        <p className="text-sm text-ink">{state.reason}</p>
        {state.letter ? (
          <p className="text-sm"><Link href={route("embryos.request-data")} className="link-target quiet-link">{REQUEST_DATA_BUTTON}</Link></p>
        ) : null}
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
          <p className="max-w-prose text-sm text-ink-muted">{FILE_RULES_BODY}</p>
          <p className="max-w-prose text-sm text-ink-muted">{FILE_FORMAT_BODY}</p>
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

/**
 * One question of a laboratory table's mapping (ADR 0037). The build
 * question is three equal actions; the column question is one choice per
 * unclear item and one action. The file's own column names appear here
 * only; the route receives column numbers. No native form is used, so
 * nothing can submit to a URL.
 */
function MappingQuestionPanel({ question, onAnswer }: { question: MappingQuestion; onAnswer: (answer: MappingAnswer) => void }) {
  const headingId = useId();
  const ids = [useId(), useId(), useId(), useId()];
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, [question.kind]);
  if (question.kind === "build") {
    const options = [["GRCh37", BUILD_OPTION_GRCH37], ["GRCh38", BUILD_OPTION_GRCH38], ["unknown", BUILD_OPTION_UNKNOWN]] as const;
    return (
      <section data-slot="upload-stage" data-stage="build-question" aria-labelledby={headingId} className="max-w-prose space-y-4">
        <h2 id={headingId} ref={ref} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">{BUILD_QUESTION_HEADING}</h2>
        <p className="text-base leading-relaxed text-ink">{BUILD_QUESTION_LEDE}</p>
        <div className="flex flex-wrap gap-3">
          {options.map(([value, label]) => (
            <Button key={value} type="button" variant="outline" size="lg" data-option={value}
              onClick={() => onAnswer({ kind: "build", referenceBuild: value })}>{label}</Button>
          ))}
        </div>
        <p className="text-sm text-ink-muted">{BUILD_UNKNOWN_NOTE}</p>
      </section>
    );
  }
  const decisions = question.decisions.slice(0, ids.length);
  const values = decisions.map((decision) => chosen[decision.field] ?? "");
  const ready = values.every((value) => value !== "") && new Set(values).size === values.length;
  return (
    <section data-slot="upload-stage" data-stage="columns-question" aria-labelledby={headingId} className="max-w-prose space-y-4">
      <h2 id={headingId} ref={ref} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">{MAPPING_COLUMNS_HEADING}</h2>
      <p className="text-base leading-relaxed text-ink">{MAPPING_COLUMNS_LEDE}</p>
      {decisions.map((decision, index) => (
        <div key={decision.field} className="space-y-2">
          <label htmlFor={ids[index]} className="block text-base font-medium text-ink">{MAPPING_FIELD_QUESTIONS[decision.field]}</label>
          <select id={ids[index]} value={chosen[decision.field] ?? ""} data-field={decision.field}
            onChange={(event) => setChosen((current) => ({ ...current, [decision.field]: event.target.value }))}
            className="block min-h-11 max-w-md rounded-md border border-line bg-card px-3 text-sm text-ink">
            <option value="">{MAPPING_CHOOSE_OPTION}</option>
            {decision.candidates.map((candidate) => (
              <option key={candidate.columnIndex} value={String(candidate.columnIndex)}>
                {mappingColumnOption(candidate.columnIndex, candidate.label)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <Button type="button" size="lg" disabled={!ready} onClick={() => onAnswer({ kind: "columns",
        mappings: decisions.map((decision) => ({ field: decision.field, columnIndex: Number(chosen[decision.field]) })) })}>
        {MAPPING_COLUMNS_BUTTON}
      </Button>
    </section>
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
