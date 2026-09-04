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
import { INITIAL_FLOW, canContinue, flowEnd, reduceFlow, stepOf, type FlowEvent, type FlowState } from "@/lib/embryos/upload-flow";
import { route } from "@/lib/primary-routes";
import { OptionArt } from "./option-art";

/**
 * <UploadFlow> — the five-step flow of `/embryos/upload` (design §2.2;
 * brief lines 374-377, 980-991, 1083; X6.1), rendered one question per
 * screen from the pure reducer in src/lib/embryos/upload-flow.ts. Every
 * answer lives in this component's state and nowhere else: no request, no
 * cookie, no device storage. The free-text answer to "Who did the testing?"
 * is not even state — the input holds it, nothing reads it, and the screen
 * says "Inherit does not keep this name."
 *
 * Each screen states "Step N of 5" and what is still to come, carries at
 * most seven interactive elements and one primary action, and moves focus
 * to its heading when it appears. Two answers end the flow on their own
 * screen: "No" to the first question and "A PDF report only" to the third.
 * The last screen is the honest terminal while ingest is unavailable
 * (design §10): the sentence, what the later steps will ask, and the letter.
 */
export function UploadFlow() {
  const [state, dispatch] = useReducer(reduceFlow, INITIAL_FLOW);
  const step = stepOf(state.screen);
  const end = flowEnd(state);
  const headingId = useId();
  const noteId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) heading.current?.focus();
    mounted.current = true;
  }, [state.screen]);

  const send = (event: FlowEvent) => dispatch(event);
  const controls = (
    <div className="flex flex-wrap gap-3">
      {state.screen === "tested" ? null : (
        <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={() => send({ type: "back" })}>
          {BACK_BUTTON}
        </Button>
      )}
      <Button type="button" size="lg" className="min-h-11" disabled={!canContinue(state)} onClick={() => send({ type: "continue" })}>
        {CONTINUE_BUTTON}
      </Button>
    </div>
  );

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
        <RadioScreen
          headingId={headingId}
          headingRef={heading}
          heading={TESTED_QUESTION_HEADING}
          name="tested"
          options={TESTED_OPTIONS}
          value={state.tested}
          onChange={(answer) => send({ type: "answer-tested", answer: answer as FlowState["tested"] & string })}
        >
          {end === "no-testing" ? (
            <FlowEnd end="no-testing" action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
              {NO_TESTING_END}
            </FlowEnd>
          ) : (
            controls
          )}
        </RadioScreen>
      ) : null}

      {state.screen === "who" ? (
        <div className="space-y-4">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
            {WHO_QUESTION_HEADING}
          </h2>
          <Input
            type="text"
            name="who"
            autoComplete="off"
            aria-labelledby={headingId}
            aria-describedby={noteId}
            className="max-w-md"
            onKeyDown={(event) => {
              if (event.key === "Enter") send({ type: "continue" });
            }}
          />
          <p id={noteId} data-slot="not-kept-note" className="text-sm text-ink-muted">
            {WHO_NOT_KEPT_NOTE}
          </p>
          {controls}
        </div>
      ) : null}

      {state.screen === "sent" ? (
        <fieldset className="space-y-4">
          <legend className="contents">
            <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              {SENT_QUESTION_HEADING}
            </h2>
          </legend>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SENT_OPTIONS.map((option) => (
              <li key={option.id}>
                <label
                  data-option={option.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-line bg-card p-4 text-base leading-snug text-ink has-[:checked]:border-ink"
                >
                  <input
                    type="radio"
                    name="sent"
                    value={option.id}
                    className="size-4 shrink-0"
                    checked={state.sent === option.id}
                    onChange={() => send({ type: "answer-sent", answer: option.id })}
                  />
                  <OptionArt option={option.id} />
                  <span>{option.label}</span>
                </label>
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
          {end === "pdf" ? (
            <FlowEnd end="pdf" action={{ label: REQUEST_DATA_BUTTON, href: route("embryos.request-data") }} back={() => send({ type: "back" })}>
              {PDF_REFUSAL}
            </FlowEnd>
          ) : (
            controls
          )}
        </fieldset>
      ) : null}

      {state.screen === "situation" ? (
        <RadioScreen
          headingId={headingId}
          headingRef={heading}
          heading={SITUATION_QUESTION_HEADING}
          name="situation"
          options={SITUATION_OPTIONS}
          value={state.situation}
          onChange={(situation) => send({ type: "choose-situation", situation: situation as FlowState["situation"] & string })}
        >
          {state.situation === null ? null : (
            <div className="space-y-3">
              <label data-slot="attestation" className="flex items-start gap-3 text-base leading-relaxed text-ink">
                <input
                  type="checkbox"
                  name="attestation"
                  className="mt-1 size-4 shrink-0"
                  checked={state.attested}
                  onChange={(event) => send({ type: "attest", attested: event.currentTarget.checked })}
                />
                <span>{SITUATION_OPTIONS.find((option) => option.id === state.situation)!.attestation}</span>
              </label>
              <p data-slot="nothing-kept-note" className="text-sm text-ink-muted">
                {NOTHING_KEPT_YET_NOTE}
              </p>
            </div>
          )}
          {controls}
        </RadioScreen>
      ) : null}

      {state.screen === "basis" ? (
        <RadioScreen
          headingId={headingId}
          headingRef={heading}
          heading={BASIS_QUESTION_HEADING}
          name="basis"
          options={BASIS_OPTIONS}
          value={state.basis}
          onChange={(basis) => send({ type: "choose-basis", basis: basis as FlowState["basis"] & string })}
        >
          {state.basis === null ? null : (
            <p role="status" data-slot="basis-sentence" className="max-w-prose text-base leading-relaxed text-ink">
              {BASIS_OPTIONS.find((option) => option.id === state.basis)!.sentence}
            </p>
          )}
          {controls}
        </RadioScreen>
      ) : null}

      {state.screen === "unavailable" ? (
        <section
          role="status"
          data-slot="ingest-unavailable"
          className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-6"
        >
          <h2 id={headingId} ref={heading} tabIndex={-1} className="font-medium outline-none">
            {INGEST_UNAVAILABLE_SENTENCE}
          </h2>
          <p className="text-base leading-relaxed text-ink">{INGEST_NEXT_STEPS}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="min-h-11">
              <Link href={route("embryos.request-data")}>{REQUEST_DATA_BUTTON}</Link>
            </Button>
            <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={() => send({ type: "back" })}>
              {BACK_BUTTON}
            </Button>
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

function RadioScreen<Id extends string>({
  headingId,
  headingRef,
  heading,
  name,
  options,
  value,
  onChange,
  children,
}: {
  headingId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  heading: string;
  name: string;
  options: readonly { id: Id; label: string }[];
  value: Id | null;
  onChange: (id: Id) => void;
  children: React.ReactNode;
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
      {children}
    </fieldset>
  );
}

/** A screen's own ending: one sentence and one primary action (design §1.4: at most one action). */
function FlowEnd({
  end,
  action,
  back,
  children,
}: {
  end: "no-testing" | "pdf";
  action: { label: string; href: string };
  back?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section role="status" data-slot="flow-end" data-end={end} className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-5">
      <p className="text-base leading-relaxed text-ink">{children}</p>
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
    </section>
  );
}
