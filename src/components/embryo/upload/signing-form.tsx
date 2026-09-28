"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ARTIFACT_HEADINGS,
  REQUEST_FAILED_STATUS,
  SIGNING_STATUS,
  STATEMENT_SENTENCES,
  TYPED_NAME_ERROR_STATUS,
  TYPED_NAME_LABEL,
  TYPED_NAME_NOTE,
  artifactVersionNote,
} from "@/copy/embryos/signing";
import { typedNameIsValid } from "@/lib/embryos/basis";
import type { SignableArtifact } from "@/lib/embryos/upload-stage";
import { UPLOAD_CSRF_HEADER } from "@/lib/embryos/upload-transport";

/**
 * <ArtifactSigningForm> — the Tier-2 signing of one or more embryo artifacts
 * against one cohort draft (register api.consents, `sign-artifact` with
 * `cohortDraftId`). Each artifact is shown in full — its summary, its body
 * and its digest — above its statements, and every statement is a required
 * checkbox; one typed name then signs them all.
 *
 * One request per artifact, in order, each spending its own one-time token
 * and presentation: a replay, a stale page or another account's token is
 * refused by the route, and the form says so without guessing why. The
 * signature ids come back to the caller, which is how step 4 hands the
 * acknowledgement ids to finalize.
 */
export function ArtifactSigningForm({
  draftId,
  artifacts,
  submitLabel,
  onSigned,
  children,
}: {
  draftId: string;
  artifacts: SignableArtifact[];
  submitLabel: string;
  onSigned: (ids: Partial<Record<SignableArtifact["key"], string>>) => Promise<void> | void;
  children?: React.ReactNode;
}) {
  const [status, setStatus] = useState<"ready" | "pending" | "failed">("ready");
  const [nameError, setNameError] = useState(false);
  const submitting = useRef(false);
  const nameId = useId();
  const noteId = useId();
  const errorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const typedName = String(new FormData(event.currentTarget).get("typedName") ?? "").trim();
    if (artifacts.length > 0 && !typedNameIsValid(typedName)) {
      setNameError(true);
      return;
    }
    setNameError(false);
    submitting.current = true;
    setStatus("pending");
    const ids: Partial<Record<SignableArtifact["key"], string>> = {};
    try {
      for (const artifact of artifacts) {
        const response = await fetch("/api/consents", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", [UPLOAD_CSRF_HEADER]: artifact.csrfToken },
          body: JSON.stringify({
            action: "sign-artifact", signatureClass: "tier2", cohortDraftId: draftId,
            artifactVersion: artifact.version, artifactPresentationToken: artifact.presentationToken,
            affirmed: true, statementKeys: artifact.statementKeys, typedName,
          }),
        });
        if (response.status !== 201) throw new Error("refused");
        const receipt = (await response.json()) as { recordId?: unknown };
        if (typeof receipt.recordId !== "string") throw new Error("refused");
        ids[artifact.key] = receipt.recordId;
      }
      await onSigned(ids);
      setStatus("ready");
    } catch {
      setStatus("failed");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form onSubmit={submit} data-slot="signing-form" className="space-y-8">
      {artifacts.map((artifact) => (
        <fieldset
          key={artifact.key}
          data-artifact={artifact.key}
          disabled={status === "pending"}
          className="space-y-4 rounded-2xl border border-line bg-card p-5"
        >
          <legend className="px-1 text-lg font-semibold text-ink">{ARTIFACT_HEADINGS[artifact.key]}</legend>
          <p className="text-sm text-ink-muted">{artifactVersionNote(artifact.version, artifact.effectiveOn)}</p>
          <p data-legal-summary className="max-w-prose whitespace-pre-wrap text-base leading-relaxed text-ink">{artifact.summary}</p>
          <div className="max-w-prose whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed text-ink">{artifact.body}</div>
          <p className="break-all font-mono text-xs text-ink-muted">sha256 {artifact.sha256}</p>
          <div className="space-y-3">
            {artifact.statementKeys.map((key) => (
              <label key={key} className="flex min-h-11 items-start gap-3 text-base leading-relaxed text-ink">
                <input type="checkbox" required name={`${artifact.key}:${key}`} className="mt-1 size-4 shrink-0" />
                <span>{STATEMENT_SENTENCES[key]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {children}
      <fieldset disabled={status === "pending"} className="space-y-4">
        {artifacts.length > 0 ? (
          <div className="space-y-2">
            <label htmlFor={nameId} className="block text-base font-medium text-ink">{TYPED_NAME_LABEL}</label>
            <Input
              id={nameId}
              name="typedName"
              autoComplete="name"
              required
              maxLength={200}
              aria-invalid={nameError}
              aria-describedby={nameError ? `${noteId} ${errorId}` : noteId}
              onChange={() => setNameError(false)}
              className="max-w-md"
            />
            <p id={noteId} className="text-sm text-ink-muted">{TYPED_NAME_NOTE}</p>
            {nameError ? <p id={errorId} role="alert" className="text-sm text-ink">{TYPED_NAME_ERROR_STATUS}</p> : null}
          </div>
        ) : null}
        <Button type="submit" size="lg">{status === "pending" ? SIGNING_STATUS : submitLabel}</Button>
      </fieldset>
      {status === "failed" ? <p role="alert" data-slot="signing-failed" className="max-w-prose text-sm text-ink">{REQUEST_FAILED_STATUS}</p> : null}
    </form>
  );
}
