"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  JURISDICTION_AFFIRM,
  JURISDICTION_BODY,
  JURISDICTION_CHANGE_WARNING,
  JURISDICTION_HEADING,
  JURISDICTION_OWN_RESULTS,
  JURISDICTION_PLACEHOLDER,
  JURISDICTION_READ_ATTESTATION,
  JURISDICTION_REQUIRED,
  JURISDICTION_SAVE,
  JURISDICTION_SAVED,
  JURISDICTION_SAVE_FAILED,
  JURISDICTION_SELECT_LABEL,
  JURISDICTION_STATE_LABEL,
  JURISDICTION_STATE_PLACEHOLDER,
  JURISDICTION_WITHHELD,
  JURISDICTION_WITHHELD_LINK,
  jurisdictionCurrent,
  jurisdictionNotServed,
} from "@/copy/settings/jurisdiction";
import { isEmbargoedCountry } from "@/lib/legal/service-restrictions";
import { route } from "@/lib/primary-routes";

/**
 * The declaration control for `profiles.jurisdiction_code` (G5.1a, ADR 0032),
 * at the top of `/settings`, where the first sign-in lands until a country is
 * chosen. The selection always starts empty, including when a country is
 * already recorded: a change is a new answer, never an edit of a pre-filled
 * one. The attestation version and hash the page was rendered with travel in
 * the request, so a page older than the published text is refused rather
 * than recorded against words the person did not see.
 *
 * The list leaves out the countries `service-restrictions.ts` withholds, and
 * says so with a link to the public list, so a missing country is explained
 * rather than silent.
 *
 * A country with committed states (today only the United States) also asks
 * for the state, in a second required list shown only once that country is
 * chosen (ADR 0032, 27 Sep 2026). Like the country, it starts empty.
 */
export function JurisdictionForm({
  choices,
  states,
  current,
  attestation,
  next,
}: {
  choices: readonly { code: string; name: string }[];
  /** Each country that also asks for a state, with its states. */
  states: Readonly<Record<string, readonly { code: string; name: string }[]>>;
  current: { code: string; name: string; state: { code: string; name: string } | null } | null;
  attestation: { version: number; sha256: string; summary: string; body: string };
  /** Where the first sign-in continues once a country is saved; null on an ordinary visit. */
  next: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [country, setCountry] = useState("");
  const stateChoices = states[country] ?? [];

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setState("saving");
    try {
      const response = await fetch("/api/settings/jurisdiction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(data.get("jurisdictionCode") ?? ""),
          ...(stateChoices.length > 0 ? { subdivision: String(data.get("jurisdictionSubdivision") ?? "") } : {}),
          attestationVersion: attestation.version,
          attestationHash: attestation.sha256,
          affirmed: data.get("affirmed") === "on",
        }),
      });
      // Reading the body also releases it: a response nothing reads stays open.
      await response.json().catch(() => null);
      if (!response.ok) {
        setState("failed");
        return;
      }
      setState("saved");
      form.reset();
      setCountry("");
      // The first sign-in continues with a full page load. A client-side push
      // reuses the redirect the router cached for `next` while no country was
      // recorded (the sidebar prefetches Overview), and leaves the person
      // here. A document request makes the gate read the answer just saved.
      if (next) window.location.assign(next);
      else router.refresh();
    } catch {
      setState("failed");
    }
  }

  return (
    <section id="jurisdiction" data-slot="jurisdiction" className="plate">
      <div className="plate-head"><h2 className="eyebrow">{JURISDICTION_HEADING}</h2></div>
      <div className="plate-body rec-stack">
        {current ? null : <p className="max-w-measure text-sm text-ink">{JURISDICTION_REQUIRED}</p>}
        <p className="max-w-measure text-sm text-ink-muted">{JURISDICTION_BODY}</p>
        <p className="max-w-measure text-sm text-ink-muted">{JURISDICTION_OWN_RESULTS}</p>
        {current ? (
          <p className="max-w-measure text-sm text-ink" data-slot="jurisdiction-current" data-jurisdiction-code={current.code}>
            {jurisdictionCurrent(current.name, current.state?.name ?? null)}
          </p>
        ) : null}
        {current && isEmbargoedCountry(current.code) ? (
          <p className="max-w-measure text-sm text-ink" data-slot="jurisdiction-not-served">{jurisdictionNotServed(current.name)}</p>
        ) : null}
        <form
          className="rec-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <fieldset className="rec-stack" disabled={state === "saving"}>
            <label className="rec-field text-sm text-ink">
              <span className="label">{JURISDICTION_SELECT_LABEL}</span>
              <select
                required
                name="jurisdictionCode"
                value={country}
                onChange={(event) => setCountry(event.currentTarget.value)}
                className="rec-select"
              >
                <option value="" disabled>{JURISDICTION_PLACEHOLDER}</option>
                {choices.map((choice) => (
                  <option key={choice.code} value={choice.code}>{choice.name}</option>
                ))}
              </select>
            </label>
            {stateChoices.length > 0 ? (
              <label className="rec-field text-sm text-ink" data-slot="jurisdiction-state">
                <span className="label">{JURISDICTION_STATE_LABEL}</span>
                <select
                  required
                  key={country}
                  name="jurisdictionSubdivision"
                  defaultValue=""
                  className="rec-select"
                >
                  <option value="" disabled>{JURISDICTION_STATE_PLACEHOLDER}</option>
                  {stateChoices.map((choice) => (
                    <option key={choice.code} value={choice.code}>{choice.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="max-w-measure text-sm text-ink-muted" data-slot="jurisdiction-withheld">
              {JURISDICTION_WITHHELD}{" "}
              <Link href={route("legal.where-inherit-works")} className="prose-link">
                {JURISDICTION_WITHHELD_LINK}
              </Link>
            </p>
            <p className="max-w-measure text-sm text-ink-muted">{attestation.summary}</p>
            <details className="max-w-measure text-sm text-ink-muted">
              <summary className="quiet-link">{JURISDICTION_READ_ATTESTATION}</summary>
              <div className="mt-2 whitespace-pre-line">{attestation.body}</div>
            </details>
            <label className="rec-choice text-sm text-ink">
              <input type="checkbox" name="affirmed" required className="size-5 accent-forest" />
              <span>{JURISDICTION_AFFIRM}</span>
            </label>
            {current ? <p className="max-w-measure text-sm text-ink-muted">{JURISDICTION_CHANGE_WARNING}</p> : null}
            <div><Button type="submit" data-slot="jurisdiction-save">{JURISDICTION_SAVE}</Button></div>
          </fieldset>
          <p role="status" aria-live="polite" className="text-sm text-ink">
            {state === "saved" ? JURISDICTION_SAVED : null}
          </p>
          {state === "failed" ? <p role="alert" className="text-sm text-ink">{JURISDICTION_SAVE_FAILED}</p> : null}
        </form>
      </div>
    </section>
  );
}
