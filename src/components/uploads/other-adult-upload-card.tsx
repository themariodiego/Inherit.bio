"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OTHER_ADULT_UPLOAD_COPY as COPY } from "@/copy/upload/other-adult";
import { route } from "@/lib/primary-routes";
import {
  otherAdultTypedNameIsValid,
  type OtherAdultTarget,
} from "@/lib/uploads/other-adult-upload";
import { uploadHeldSubjectFile, type UploadProgress } from "@/lib/uploads/subject-upload-browser";
import type { OwnUploadLimits } from "@/lib/uploads/subject-upload-contract";

function day(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * One reservation of the signed-in person's own pending adult invitation:
 * sign the draft permission (Tier 2: each statement its own checkbox, a
 * typed name, the warning above the control), then add the file. The file
 * is stored and held; this card then shows one line and nothing else.
 */
export function OtherAdultUploadCard({ target, limits = null }: { target: OtherAdultTarget; limits?: OwnUploadLimits | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [heldNow, setHeldNow] = useState(false);
  const [uploadError, setUploadError] = useState(false);

  const held = heldNow || target.state === "held";
  const heading = <h3 className="font-medium">{target.label} · {COPY.invitedOn(day(target.invitedAt))}</h3>;

  if (held) {
    return <article className="space-y-2 rounded-2xl border border-line bg-card p-6" data-slot="other-adult-held">
      {heading}
      <p role="status" className="text-sm">{COPY.heldStatus(target.label)}</p>
      <p className="text-sm text-ink-muted">{COPY.heldDeadline(day(target.deleteBy ?? target.answerBy))}</p>
    </article>;
  }
  if (target.state === "reviewing" || target.blockedBy) {
    return <article className="space-y-2 rounded-2xl border border-line bg-card p-6">
      {heading}
      <p role="status" className="text-sm">{target.state === "reviewing" ? COPY.reviewingStatus
        : target.blockedBy === "account-completion" ? COPY.accountFirstStatus : COPY.unavailableStatus}</p>
    </article>;
  }

  if (target.state === "unsigned" && target.consent) {
    const consent = target.consent;
    const allChecked = consent.statements.every(statement => checked[statement.key]);
    async function sign(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!otherAdultTypedNameIsValid(typedName)) { setNameError(true); return; }
      setSigning(true); setSignError(false);
      try {
        const response = await fetch(route("api.consents"), {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", "x-inherit-csrf": consent.token },
          body: JSON.stringify({
            action: "sign-artifact", signatureClass: "tier2", subjectDraftId: target.subjectId,
            artifactVersion: consent.version, artifactPresentationToken: consent.token, affirmed: true,
            statementKeys: consent.statements.map(statement => statement.key), typedName: typedName.trim(),
          }),
        });
        if (response.status !== 201) throw new Error("not_signed");
        router.refresh();
      } catch { setSignError(true); setSigning(false); }
    }
    return <article className="space-y-5 rounded-2xl border border-line bg-card p-6">
      {heading}
      <h4 className="display text-xl">{COPY.signHeading}</h4>
      <p className="text-sm text-ink-muted">{COPY.versionLine(consent.version, consent.effectiveOn)}</p>
      <p data-legal-summary className="text-sm">{consent.summary}</p>
      <div className="whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed">{consent.body}</div>
      <form onSubmit={sign} className="space-y-4">
        <fieldset disabled={signing} className="space-y-3">
          <legend className="font-medium">{COPY.statementsHeading}</legend>
          {consent.statements.map(statement => (
            <label key={statement.key} className="flex min-h-11 items-start gap-3">
              <input type="checkbox" name={statement.key} checked={Boolean(checked[statement.key])}
                onChange={event => setChecked(current => ({ ...current, [statement.key]: event.target.checked }))}
                className="mt-1 size-5 shrink-0 accent-forest" />
              <span>{statement.text}</span>
            </label>
          ))}
          <label className="block space-y-2">
            <span>{COPY.typedNameLabel}</span>
            <Input name="typedName" autoComplete="name" maxLength={200} value={typedName}
              aria-invalid={nameError} aria-describedby={nameError ? `name-error-${target.subjectId}` : undefined}
              onChange={event => { setTypedName(event.target.value); setNameError(false); }} />
          </label>
          {nameError ? <p id={`name-error-${target.subjectId}`} role="alert" className="text-sm text-danger">{COPY.typedNameError}</p> : null}
        </fieldset>
        <p className="text-base">{consent.warning}</p>
        {signError ? <p role="alert" className="text-sm text-danger">{COPY.signFailed}</p> : null}
        <Button type="submit" disabled={!allChecked || typedName.trim().length === 0 || signing}>
          {signing ? COPY.signing : COPY.signButton}
        </Button>
      </form>
    </article>;
  }

  async function handleFile(file: File) {
    if (inFlight.current) return;
    inFlight.current = true;
    setUploadError(false);
    try {
      await uploadHeldSubjectFile(file, target.subjectId, setProgress, limits);
      setHeldNow(true);
      router.refresh();
    } catch { setUploadError(true); setProgress(null); }
    finally {
      inFlight.current = false;
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  const busy = progress !== null && !uploadError;
  return <article className="space-y-3 rounded-2xl border border-dashed border-line bg-card p-6">
    {heading}
    <h4 className="font-medium">{COPY.chooseHeading}</h4>
    <p className="text-sm text-ink-muted">{COPY.chooseDetail}</p>
    <input ref={inputRef} type="file" className="sr-only" aria-hidden tabIndex={-1} aria-label={COPY.chooseLabel}
      data-slot="other-adult-file" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} />
    <Button onClick={() => inputRef.current?.click()} disabled={busy}>{COPY.chooseButton}</Button>
    <div aria-live="polite" className="text-sm">
      {progress?.step === "checking" ? <p>{COPY.progress.checking}</p>
        : progress?.step === "hashing" ? <p>{COPY.progress.hashing(progress.pct)}</p>
        : progress?.step === "uploading" ? <p>{COPY.progress.uploading(progress.pct)}</p>
        : progress?.step === "validating" ? <p>{COPY.progress.validating}</p> : null}
      {uploadError ? <p role="alert" className="text-danger">{COPY.uploadFailed}</p> : null}
    </div>
  </article>;
}
