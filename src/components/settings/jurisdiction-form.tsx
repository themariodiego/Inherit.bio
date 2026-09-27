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
 */
export function JurisdictionForm({
  choices,
  current,
  attestation,
  next,
}: {
  choices: readonly { code: string; name: string }[];
  current: { code: string; name: string } | null;
  attestation: { version: number; sha256: string; summary: string; body: string };
  /** Where the first sign-in continues once a country is saved; null on an ordinary visit. */
  next: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setState("saving");
    try {
      const response = await fetch("/api/settings/jurisdiction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(data.get("jurisdictionCode") ?? ""),
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
    <section id="jurisdiction" data-slot="jurisdiction" className="space-y-4 rounded-2xl border border-line bg-card p-6">
      <h2 className="font-medium">{JURISDICTION_HEADING}</h2>
      {current ? null : <p className="text-sm text-ink">{JURISDICTION_REQUIRED}</p>}
      <p className="text-sm text-ink-muted">{JURISDICTION_BODY}</p>
      <p className="text-sm text-ink-muted">{JURISDICTION_OWN_RESULTS}</p>
      {current ? (
        <p className="text-sm text-ink" data-slot="jurisdiction-current" data-jurisdiction-code={current.code}>
          {jurisdictionCurrent(current.name)}
        </p>
      ) : null}
      {current && isEmbargoedCountry(current.code) ? (
        <p className="text-sm text-ink" data-slot="jurisdiction-not-served">{jurisdictionNotServed(current.name)}</p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(event.currentTarget);
        }}
      >
        <fieldset className="space-y-4" disabled={state === "saving"}>
          <label className="block text-sm text-ink">
            {JURISDICTION_SELECT_LABEL}
            <select
              required
              name="jurisdictionCode"
              defaultValue=""
              className="mt-2 block min-h-11 w-full max-w-md rounded-lg border border-line bg-card p-3"
            >
              <option value="" disabled>{JURISDICTION_PLACEHOLDER}</option>
              {choices.map((choice) => (
                <option key={choice.code} value={choice.code}>{choice.name}</option>
              ))}
            </select>
          </label>
          <p className="max-w-prose text-sm text-ink-muted" data-slot="jurisdiction-withheld">
            {JURISDICTION_WITHHELD}{" "}
            <Link href={route("legal.where-inherit-works")} className="link-target underline underline-offset-4 hover:text-ink">
              {JURISDICTION_WITHHELD_LINK}
            </Link>
          </p>
          <p className="max-w-prose text-sm text-ink-muted">{attestation.summary}</p>
          <details className="max-w-prose text-sm text-ink-muted">
            <summary className="link-target cursor-pointer underline underline-offset-4">{JURISDICTION_READ_ATTESTATION}</summary>
            <div className="mt-2 whitespace-pre-line">{attestation.body}</div>
          </details>
          <label className="flex min-h-[var(--size-control)] items-center gap-3 text-sm text-ink">
            <input type="checkbox" name="affirmed" required className="size-4" />
            {JURISDICTION_AFFIRM}
          </label>
          {current ? <p className="max-w-prose text-sm text-ink-muted">{JURISDICTION_CHANGE_WARNING}</p> : null}
          <Button type="submit" data-slot="jurisdiction-save">{JURISDICTION_SAVE}</Button>
        </fieldset>
        <p role="status" aria-live="polite" className="text-sm text-ink">
          {state === "saved" ? JURISDICTION_SAVED : null}
        </p>
        {state === "failed" ? <p role="alert" className="text-sm text-ink">{JURISDICTION_SAVE_FAILED}</p> : null}
      </form>
    </section>
  );
}
