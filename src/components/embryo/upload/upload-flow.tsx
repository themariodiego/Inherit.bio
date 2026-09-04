"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BACK_BUTTON,
  BACK_TO_EMBRYOS_LINK,
  BASIS_OPTIONS,
  BASIS_QUESTION_HEADING,
  CONTINUE_BUTTON,
  INGEST_NEXT_STEPS,
  INGEST_UNAVAILABLE_SENTENCE,
  NOTHING_KEPT_YET_NOTE,
  NO_TESTING_END,
  PDF_REFUSAL,
  REQUEST_DATA_BUTTON,
  SENT_OPTIONS,
  SENT_QUESTION_HEADING,
  SENT_UNKNOWN_LINK,
  SITUATION_OPTIONS,
  SITUATION_QUESTION_HEADING,
  STILL_TO_COME_STATUS,
  TESTED_OPTIONS,
  TESTED_QUESTION_HEADING,
  WHO_NOT_KEPT_NOTE,
  WHO_QUESTION_HEADING,
  stepStatus,
} from "@/copy/embryos/upload";
import {
  INITIAL_FLOW,
  asksWho,
  canContinue,
  flowEnd,
  reduceFlow,
  stepOf,
  type FlowEvent,
  type FlowState,
} from "@/lib/embryos/upload-flow";
import { route } from "@/lib/primary-routes";
import { OptionArt } from "./option-art";

/**
 * <UploadFlow> — the five-step flow of `/embryos/upload` (design §2.2;
 * brief lines 374-377, 980-991, 1083; X6.1), rendered screen by screen from
 * the pure reducer in src/lib/embryos/upload-flow.ts. Every answer lives in
 * this component's state and nowhere else: no request, no cookie, no
 * device storage. The free-text answer to "Who did the testing?" is not
 * even state — the input holds it, nothing reads it, and the screen says
 * "Inherit does not keep this name."
 *
 * Each screen states "Step N of 5" and what is still to come, carries at
 * most five interactive elements of its own (the shell's search button and
 * desktop attribution link make seven, X6.1's cap) and at most one primary
 * action, and moves focus to its heading when it appears. Screens of equal
 * choices — what the laboratory sent, who can sign — are actions: choosing
 * moves on. "No" to the first question ends the flow on that screen; a PDF
 * lands on its own refusal screen. The last screen is the honest terminal
 * while ingest is unavailable (design §10): the sentence, what the later
 * steps will ask, and the letter.
 */
export function UploadFlow({ initial = INITIAL_FLOW }: { initial?: FlowState }) {
  const [state, dispatch] = useReducer(reduceFlow, initial);
  const step = stepOf(state.screen);
  const end = flowEnd(state);
  const headingId = useId();
  const whoId = useId();
  const noteId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const terminal = useRef<HTMLParagraphElement>(null);
  const ending = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);

  // A new screen: focus its heading (or, on the terminal, its sentence).
  useEffect(() => {
    if (mounted.current) (heading.current ?? terminal.current)?.focus();
    mounted.current = true;
  }, [state.screen]);
  // "No" ends the first screen in place: focus the ending so it is read.
  useEffect(() => {
    if (end === "no-testing") ending.current?.focus();
  }, [end]);

  const send = (event: FlowEvent) => dispatch(event);
  const backButton = (
    <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={() => send({ type: "back" })}>
      {BACK_BUTTON}
    </Button>
  );
  const continueButton = (
    <Button type="button" size="lg" className="min-h-11" disabled={!canContinue(state)} onClick={() => send({ type: "continue" })}>
      {CONTINUE_BUTTON}
    </Button>
  );
  const chosenSituation = SITUATION_OPTIONS.find((option) => option.id === state.situation) ?? null;
  const chosenBasis = BASIS_OPTIONS.find((option) => option.id === state.basis) ?? null;

  return (
    <section
      data-slot="upload-flow"
      data-screen={state.screen}
      data-step={step ?? undefined}
      aria-labelledby={headingId}
      className="space-y-6"
    >
      {step === null ? null : (
        <div className="space-y-1">
          <p role="status" data-slot="step-status" className="text-sm font-medium text-ink">
            {stepStatus(step)}
          </p>
          <p data-slot="still-to-come" className="text-sm leading-relaxed text-ink-muted">
            {STILL_TO_COME_STATUS[step]}
          </p>
        </div>
      )}

      {state.screen === "tested" ? (
        <div className="space-y-6">
          <RadioGroup
            headingId={headingId}
            headingRef={heading}
            heading={TESTED_QUESTION_HEADING}
            name="tested"
            options={TESTED_OPTIONS}
            value={state.tested}
            onChange={(answer) => send({ type: "answer-tested", answer })}
          />
          {asksWho(state) ? (
            <div data-slot="who-question" className="space-y-4">
              <h2 id={whoId} className="text-lg font-semibold text-ink">
                {WHO_QUESTION_HEADING}
              </h2>
              <Input
                type="text"
                name="who"
                autoComplete="off"
                aria-labelledby={whoId}
                aria-describedby={noteId}
                className="max-w-md"
                onKeyDown={(event) => {
                  if (event.key === "Enter") send({ type: "continue" });
                }}
              />
              <p id={noteId} data-slot="not-kept-note" className="text-sm text-ink-muted">
                {WHO_NOT_KEPT_NOTE}
              </p>
            </div>
          ) : null}
          {end === "no-testing" ? (
            <FlowEnd end="no-testing" sentenceRef={ending} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
              {NO_TESTING_END}
            </FlowEnd>
          ) : (
            <div className="flex flex-wrap gap-3">{continueButton}</div>
          )}
        </div>
      ) : null}

      {state.screen === "sent" ? (
        <div className="space-y-4">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {SENT_QUESTION_HEADING}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SENT_OPTIONS.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  data-option={option.id}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left text-base leading-snug text-ink hover:border-ink"
                  onClick={() => send({ type: "answer-sent", answer: option.id })}
                >
                  <OptionArt option={option.id} />
                  <span>{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <button
              type="button"
              data-slot="sent-unknown"
              className="min-h-11 text-left underline underline-offset-2"
              onClick={() => send({ type: "answer-sent", answer: "unknown" })}
            >
              {SENT_UNKNOWN_LINK}
            </button>
          </p>
        </div>
      ) : null}

      {state.screen === "pdf-end" ? (
        <FlowEnd
          end="pdf"
          heading={SENT_OPTIONS.find((option) => option.id === "pdf-only")!.label}
          headingId={headingId}
          headingRef={heading}
          action={{ label: REQUEST_DATA_BUTTON, href: route("embryos.request-data") }}
          back={() => send({ type: "back" })}
        >
          {PDF_REFUSAL}
        </FlowEnd>
      ) : null}

      {state.screen === "situation" ? (
        <div className="space-y-4">
          <RadioGroup
            headingId={headingId}
            headingRef={heading}
            heading={SITUATION_QUESTION_HEADING}
            name="situation"
            options={SITUATION_OPTIONS}
            value={state.situation}
            onChange={(situation) => send({ type: "choose-situation", situation })}
          />
          {chosenSituation === null ? null : (
            <div className="space-y-3">
              <label data-slot="attestation" className="flex items-start gap-3 text-base leading-relaxed text-ink">
                <input
                  type="checkbox"
                  name="attestation"
                  className="mt-1 size-4 shrink-0"
                  checked={state.attested}
                  onChange={(event) => send({ type: "attest", attested: event.currentTarget.checked })}
                />
                <span>{chosenSituation.attestation}</span>
              </label>
              <p data-slot="nothing-kept-note" className="text-sm text-ink-muted">
                {NOTHING_KEPT_YET_NOTE}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {backButton}
            {continueButton}
          </div>
        </div>
      ) : null}

      {state.screen === "basis" ? (
        <div className="space-y-4">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {BASIS_QUESTION_HEADING}
          </h2>
          <ul className="space-y-2">
            {BASIS_OPTIONS.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  data-option={option.id}
                  className="flex min-h-11 w-full cursor-pointer items-center rounded-2xl border border-line bg-card px-4 py-3 text-left text-base leading-relaxed text-ink hover:border-ink"
                  onClick={() => send({ type: "choose-basis", basis: option.id })}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">{backButton}</div>
        </div>
      ) : null}

      {state.screen === "basis-named" && chosenBasis ? (
        <div className="space-y-4">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {chosenBasis.label}
          </h2>
          <p data-slot="basis-sentence" className="max-w-prose text-base leading-relaxed text-ink">
            {chosenBasis.sentence}
          </p>
          <div className="flex flex-wrap gap-3">
            {backButton}
            {continueButton}
          </div>
        </div>
      ) : null}

      {state.screen === "unavailable" ? (
        <section
          data-slot="ingest-unavailable"
          className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-6"
        >
          <p id={headingId} ref={terminal} tabIndex={-1} className="font-medium text-ink outline-none">
            {INGEST_UNAVAILABLE_SENTENCE}
          </p>
          <p className="text-base leading-relaxed text-ink">{INGEST_NEXT_STEPS}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="min-h-11">
              <Link href={route("embryos.request-data")}>{REQUEST_DATA_BUTTON}</Link>
            </Button>
            {backButton}
          </div>
          <p className="text-sm">
            <Link href={route("embryos.index")} className="inline-flex min-h-11 items-center underline underline-offset-2">
              {BACK_TO_EMBRYOS_LINK}
            </Link>
          </p>
        </section>
      ) : null}
    </section>
  );
}

function RadioGroup<Id extends string>({
  headingId,
  headingRef,
  heading,
  name,
  options,
  value,
  onChange,
}: {
  headingId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  heading: string;
  name: string;
  options: readonly { id: Id; label: string }[];
  value: Id | null;
  onChange: (id: Id) => void;
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="contents">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
          {heading}
        </h2>
      </legend>
      <ul className="space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            <label data-option={option.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-base leading-relaxed text-ink">
              <input
                type="radio"
                name={name}
                value={option.id}
                className="size-4 shrink-0"
                checked={value === option.id}
                onChange={() => onChange(option.id)}
              />
              <span>{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * A flow ending: one sentence and one primary action (design §1.4: at most
 * one action). As a screen of its own it carries a short heading that takes
 * focus, Back and the way back to Embryos; in place on the first screen its
 * sentence takes focus instead. Neither is a live region: focus is what
 * gets the ending read.
 */
function FlowEnd({
  end,
  heading,
  headingId,
  headingRef,
  sentenceRef,
  action,
  back,
  children,
}: {
  end: "no-testing" | "pdf";
  heading?: string;
  headingId?: string;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  sentenceRef?: React.RefObject<HTMLParagraphElement | null>;
  action: { label: string; href: string };
  back?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="flow-end" data-end={end} className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-5">
      {heading ? (
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
          {heading}
        </h2>
      ) : null}
      <p ref={sentenceRef} tabIndex={sentenceRef ? -1 : undefined} className="text-base leading-relaxed text-ink outline-none">
        {children}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg" className="min-h-11">
          <Link href={action.href}>{action.label}</Link>
        </Button>
        {back ? (
          <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={back}>
            {BACK_BUTTON}
          </Button>
        ) : null}
      </div>
      {back ? (
        <p className="text-sm">
          <Link href={route("embryos.index")} className="inline-flex min-h-11 items-center underline underline-offset-2">
            {BACK_TO_EMBRYOS_LINK}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
