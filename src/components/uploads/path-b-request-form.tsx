"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * sign, refuse or delete. Signed in with the invited address, they sign with
 * that account instead and its own country counts (Path B's account branch).
 * The flow is for tests only, and the page says so.
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
    const subjectArtifact = {
      artifactVersion: review.artifact.version, artifactPresentationToken: review.artifact.presentationToken,
      affirmed: true, statementKeys: review.artifact.statements.map(statement => statement.key),
      typedName: typedName.trim(),
    };
    // Signed in with the invited address: the account's own country counts,
    // so no country is sent (Path B's account branch).
    await send("confirm", review.account ? { withAccount: true, subjectArtifact } : {
      subjectArtifact,
      jurisdictionCode: country, jurisdictionAttestationVersion: review.attestation.version,
      jurisdictionAttestationHash: review.attestation.sha256, jurisdictionAffirmed: true,
    });
  }

  if (status === "confirm" || status === "refuse" || status === "delete") {
    const receipt = status === "confirm" && review.account ? COPY.receipts.confirmAccount : COPY.receipts[status];
    return (
      <section className="rec-column rec-head px-6 py-16" role="status">
        <p className="eyebrow">Your rights</p>
        <h1 className="display">{receipt.title}</h1>
        <p className="lede">{receipt.body}</p>
      </section>
    );
  }

  const busy = status === "pending";
  const ready = review.artifact.statements.every(statement => checked[statement.key])
    && typedName.trim().length > 0 && (review.account !== null || (country !== "" && affirmed));
  return (
    <section className="rec-column px-6 py-16" data-slot="path-b-request">
      <header className="rec-head">
        <p className="eyebrow">Your rights</p>
        <h1 className="display">{COPY.heading}</h1>
        <p className="max-w-measure">{COPY.detail(review.label)}</p>
        <p role="note" className="max-w-measure text-sm">{COPY.testNote}</p>
      </header>
      <form onSubmit={sign} className="surface surface-pad rec-stack mt-10">
        <p className="caption">Version {review.artifact.version} · effective {review.artifact.effectiveOn}</p>
        <p data-legal-summary className="max-w-measure whitespace-pre-wrap text-sm leading-relaxed">{review.artifact.summary}</p>
        <div className="max-w-measure whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed">{review.artifact.body}</div>
        <fieldset disabled={busy} className="rec-stack">
          <legend className="label">{COPY.statementsHeading}</legend>
          {review.artifact.statements.map(statement => (
            <label key={statement.key} className="rec-choice">
              <input type="checkbox" name={statement.key} checked={Boolean(checked[statement.key])}
                onChange={event => setChecked(current => ({ ...current, [statement.key]: event.target.checked }))}
                className="size-5 accent-forest" />
              <span>{statement.text}</span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={busy} className="rec-stack">
          {review.account ? (
            <p role="note" className="max-w-measure text-sm" data-slot="path-b-account">{COPY.accountNote(review.account.country)}</p>
          ) : (
            <>
              <label className="rec-field">
                <span className="label">{JURISDICTION_SELECT_LABEL}</span>
                <select name="jurisdictionCode" required value={country} onChange={event => setCountry(event.target.value)}
                  className="rec-select">
                  <option value="" disabled>{JURISDICTION_PLACEHOLDER}</option>
                  {review.countries.map(choice => <option key={choice.code} value={choice.code}>{choice.name}</option>)}
                </select>
              </label>
              <details className="max-w-measure text-sm">
                <summary className="quiet-link">{JURISDICTION_READ_ATTESTATION}</summary>
                <p className="mt-2 whitespace-pre-wrap">{review.attestation.summary}</p>
              </details>
              <label className="rec-choice">
                <input type="checkbox" name="jurisdictionAffirmed" checked={affirmed}
                  onChange={event => setAffirmed(event.target.checked)} className="size-5 accent-forest" />
                <span>{JURISDICTION_AFFIRM}</span>
              </label>
            </>
          )}
          <div className="rec-field">
            <Label htmlFor="path-b-typed-name">{COPY.typedNameLabel}</Label>
            <Input id="path-b-typed-name" name="typedName" autoComplete="name" maxLength={200} value={typedName}
              aria-invalid={nameError} aria-describedby={nameError ? "path-b-name-error" : undefined}
              onChange={event => { setTypedName(event.target.value); setNameError(false); }} />
          </div>
          {nameError ? <p id="path-b-name-error" role="alert" className="text-sm text-danger">{COPY.typedNameError}</p> : null}
        </fieldset>
        <div><Button type="submit" disabled={!ready || busy}>{busy ? COPY.saving : COPY.signButton}</Button></div>
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void send("refuse", {})}>{COPY.refuseButton}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void send("delete", {})}>{COPY.deleteButton}</Button>
        </div>
        {status === "failed" ? <p role="alert" className="text-sm">{COPY.failed}</p> : null}
      </form>
    </section>
  );
}
