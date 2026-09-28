"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PATH_B_REQUEST_COPY as COPY } from "@/copy/upload/other-adult";
import {
  JURISDICTION_AFFIRM,
  JURISDICTION_PLACEHOLDER,
  JURISDICTION_READ_ATTESTATION,
  JURISDICTION_SELECT_LABEL,
} from "@/copy/settings/jurisdiction";
import { otherAdultTypedNameIsValid } from "@/lib/uploads/other-adult-upload";
import type { PathBRequestReview } from "@/lib/uploads/path-b-review";

type Operation = "confirm" | "refuse" | "delete";
type Status = "ready" | "pending" | Operation | "failed";

/**
 * The register's Path B request, as the person it names reads it on
 * `/withdraw/session`: their own artifact (each statement its own checkbox),
 * the country they live in, and their typed name. No account is needed to
 * sign, refuse or delete. The artifact is a draft the owner has not approved,
 * and the page says so.
 */
export function PathBRequestForm({ review }: { review: PathBRequestReview }) {
  const [status, setStatus] = useState<Status>("ready");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [country, setCountry] = useState("");
  const [affirmed, setAffirmed] = useState(false);

  async function send(operation: Operation, body: Record<string, unknown>) {
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, nonce: review.nonce, ...body }),
      });
      const receipt = await response.json().catch(() => null);
      setStatus(response.status === 202 && receipt?.status === "accepted" && receipt?.operation === operation
        ? operation : "failed");
    } catch { setStatus("failed"); }
  }

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!otherAdultTypedNameIsValid(typedName)) { setNameError(true); return; }
    await send("confirm", {
      subjectArtifact: {
        artifactVersion: review.artifact.version, artifactPresentationToken: review.artifact.presentationToken,
        affirmed: true, statementKeys: review.artifact.statements.map(statement => statement.key),
        typedName: typedName.trim(),
      },
      jurisdictionCode: country, jurisdictionAttestationVersion: review.attestation.version,
      jurisdictionAttestationHash: review.attestation.sha256, jurisdictionAffirmed: true,
    });
  }

  if (status === "confirm" || status === "refuse" || status === "delete") return (
    <section className="mx-auto max-w-3xl px-6 py-16" role="status">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4 text-4xl">{COPY.receipts[status].title}</h1>
      <p className="mt-5 max-w-prose text-ink-muted">{COPY.receipts[status].body}</p>
    </section>
  );

  const busy = status === "pending";
  const ready = review.artifact.statements.every(statement => checked[statement.key])
    && typedName.trim().length > 0 && country !== "" && affirmed;
  return (
    <section className="mx-auto max-w-3xl px-6 py-16" data-slot="path-b-request">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4 text-4xl">{COPY.heading}</h1>
      <p className="mt-5 max-w-prose">{COPY.detail(review.label)}</p>
      <p role="note" className="mt-3 text-sm">{COPY.testNote}</p>
      <form onSubmit={sign} className="mt-8 space-y-5 rounded-2xl border border-line bg-card p-6">
        <p className="text-sm text-ink-muted">Version {review.artifact.version} · effective {review.artifact.effectiveOn}</p>
        <p data-legal-summary className="whitespace-pre-wrap text-sm leading-relaxed">{review.artifact.summary}</p>
        <div className="whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed">{review.artifact.body}</div>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="font-medium">{COPY.statementsHeading}</legend>
          {review.artifact.statements.map(statement => (
            <label key={statement.key} className="flex min-h-11 items-start gap-3">
              <input type="checkbox" name={statement.key} checked={Boolean(checked[statement.key])}
                onChange={event => setChecked(current => ({ ...current, [statement.key]: event.target.checked }))}
                className="mt-1 size-5 shrink-0 accent-forest" />
              <span>{statement.text}</span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block space-y-2">
            <span>{JURISDICTION_SELECT_LABEL}</span>
            <select name="jurisdictionCode" required value={country} onChange={event => setCountry(event.target.value)}
              className="block min-h-11 w-full max-w-md rounded-lg border border-line bg-card p-3">
              <option value="" disabled>{JURISDICTION_PLACEHOLDER}</option>
              {review.countries.map(choice => <option key={choice.code} value={choice.code}>{choice.name}</option>)}
            </select>
          </label>
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer underline underline-offset-2">{JURISDICTION_READ_ATTESTATION}</summary>
            <p className="mt-2 whitespace-pre-wrap">{review.attestation.summary}</p>
          </details>
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" name="jurisdictionAffirmed" checked={affirmed}
              onChange={event => setAffirmed(event.target.checked)} className="mt-1 size-5 shrink-0 accent-forest" />
            <span>{JURISDICTION_AFFIRM}</span>
          </label>
          <label className="block space-y-2">
            <span>{COPY.typedNameLabel}</span>
            <Input name="typedName" autoComplete="name" maxLength={200} value={typedName}
              aria-invalid={nameError} aria-describedby={nameError ? "path-b-name-error" : undefined}
              onChange={event => { setTypedName(event.target.value); setNameError(false); }} />
          </label>
          {nameError ? <p id="path-b-name-error" role="alert" className="text-sm text-danger">{COPY.typedNameError}</p> : null}
        </fieldset>
        <Button type="submit" disabled={!ready || busy}>{busy ? COPY.saving : COPY.signButton}</Button>
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void send("refuse", {})}>{COPY.refuseButton}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void send("delete", {})}>{COPY.deleteButton}</Button>
        </div>
        {status === "failed" ? <p role="alert" className="text-sm">{COPY.failed}</p> : null}
      </form>
    </section>
  );
}
