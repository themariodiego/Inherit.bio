"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OTHER_ADULT_UPLOAD_COPY as COPY } from "@/copy/upload/other-adult";
import { route } from "@/lib/primary-routes";
import {
  isAdultOn,
  otherAdultTypedNameIsValid,
  type OtherAdultConsentView,
  type OtherAdultTarget,
} from "@/lib/uploads/other-adult-upload";
import { uploadHeldSubjectFile, type UploadProgress } from "@/lib/uploads/subject-upload-browser";
import type { OwnUploadLimits } from "@/lib/uploads/subject-upload-contract";
import { day, latestFileLine } from "./other-adult-lines";

const EMPTY_PERSON = { name: "", email: "", birth: "" };

/**
 * Step one of the register's Path B: the person's name, address and date of
 * birth reserve a draft. Nothing is sent to them yet.
 */
export function OtherAdultNewPersonForm({ token }: { token: string }) {
  const router = useRouter();
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [birthError, setBirthError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdultOn(person.birth)) { setBirthError(true); return; }
    setSaving(true); setFailed(false);
    try {
      const response = await fetch("/api/subject-drafts", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-inherit-csrf": token },
        body: JSON.stringify({ kind: "adult", adultFlow: "path-b-subject-esignature", displayName: person.name.trim(),
          dateOfBirth: person.birth, contactEmail: person.email.trim(), requestId }),
      });
      if (response.status !== 201) throw new Error("not_saved");
      setPerson(EMPTY_PERSON);
      setRequestId(crypto.randomUUID());
      router.refresh();
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }

  return <article className="space-y-4 rounded-2xl border border-line bg-card p-6" data-slot="other-adult-new">
    <h3 className="font-medium">{COPY.newHeading}</h3>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={saving} className="space-y-4">
        <label className="block space-y-2">
          <span>{COPY.nameLabel}</span>
          <Input name="displayName" required minLength={2} maxLength={80} value={person.name}
            onChange={event => setPerson(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label className="block space-y-2">
          <span>{COPY.emailLabel}</span>
          <Input name="contactEmail" type="email" required maxLength={254} value={person.email}
            onChange={event => setPerson(current => ({ ...current, email: event.target.value }))} />
        </label>
        <label className="block space-y-2">
          <span>{COPY.birthLabel}</span>
          <Input name="dateOfBirth" type="date" required value={person.birth} aria-invalid={birthError}
            aria-describedby={birthError ? "other-adult-birth-error" : undefined}
            onChange={event => { setPerson(current => ({ ...current, birth: event.target.value })); setBirthError(false); }} />
        </label>
        {birthError ? <p id="other-adult-birth-error" role="alert" className="text-sm text-danger">{COPY.birthError}</p> : null}
      </fieldset>
      {failed ? <p role="alert" className="text-sm text-danger">{COPY.detailsFailed}</p> : null}
      <Button type="submit" disabled={saving}>{saving ? COPY.saving : COPY.detailsButton}</Button>
    </form>
  </article>;
}

/**
 * The approved uploader consent, Tier 2: every statement its own checkbox, a
 * typed name, and the artifact's own warning directly above the control.
 */
function ConsentFields({ consent, checked, setChecked, typedName, setTypedName, nameError, setNameError, id }: {
  consent: OtherAdultConsentView; checked: Record<string, boolean>;
  setChecked: (update: (current: Record<string, boolean>) => Record<string, boolean>) => void;
  typedName: string; setTypedName: (value: string) => void; nameError: boolean; setNameError: (value: boolean) => void;
  id: string;
}) {
  return <>
    <h4 className="display text-xl">{COPY.signHeading}</h4>
    <p className="text-sm text-ink-muted">{COPY.versionLine(consent.version, consent.effectiveOn)}</p>
    <p data-legal-summary className="text-sm">{consent.summary}</p>
    <div className="whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed">{consent.body}</div>
    <fieldset className="space-y-3">
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
          aria-invalid={nameError} aria-describedby={nameError ? `name-error-${id}` : undefined}
          onChange={event => { setTypedName(event.target.value); setNameError(false); }} />
      </label>
      {nameError ? <p id={`name-error-${id}`} role="alert" className="text-sm text-danger">{COPY.typedNameError}</p> : null}
    </fieldset>
  </>;
}

/**
 * One Path B person of the signed-in uploader, with the one thing that can be
 * done for them now: sign and send the request, wait for their signature,
 * add a file, or wait for them to confirm it. A held file shows one line and
 * nothing to act on.
 */
export function OtherAdultUploadCard({ target, limits = null }: { target: OtherAdultTarget; limits?: OwnUploadLimits | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [heldNow, setHeldNow] = useState(false);
  const [uploadError, setUploadError] = useState(false);

  const heading = <h3 className="font-medium">{target.label} · {COPY.requestedOn(day(target.requestedAt))}</h3>;
  const latest = latestFileLine(target.label, target.latest);
  const card = (children: ReactNode, slot?: string) =>
    <article className="space-y-3 rounded-2xl border border-line bg-card p-6" data-slot={slot}>{heading}{children}</article>;

  if (heldNow || target.state === "pending") {
    return card(<>
      <p role="status" className="text-sm">{COPY.pendingStatus(target.label)}</p>
      {target.latest?.deleteBy ? <p className="text-sm text-ink-muted">{COPY.pendingDeadline(day(target.latest.deleteBy))}</p> : null}
    </>, "other-adult-held");
  }
  if (target.blockedBy) {
    return card(<p role="status" className="text-sm">
      {target.blockedBy === "account-completion" ? COPY.accountFirstStatus : COPY.unavailableStatus}</p>);
  }
  if (target.state === "awaiting-signature") {
    return card(<p role="status" className="text-sm">{COPY.awaitingSignature(target.label, day(target.answerBy))}</p>,
      "other-adult-awaiting");
  }

  const consent = target.consent;
  async function signIfNeeded(): Promise<boolean> {
    if (!consent) return true;
    const response = await fetch(route("api.consents"), {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", "x-inherit-csrf": consent.token },
      body: JSON.stringify({
        action: "sign-artifact", signatureClass: "tier2", subjectDraftId: target.subjectId,
        artifactVersion: consent.version, artifactPresentationToken: consent.token, affirmed: true,
        statementKeys: consent.statements.map(statement => statement.key), typedName: typedName.trim(),
      }),
    });
    return response.status === 201;
  }

  if (target.state === "awaiting-request" || (target.state === "ready" && consent)) {
    const sending = target.state === "awaiting-request";
    const ready = (!consent || (consent.statements.every(statement => checked[statement.key])
      && typedName.trim().length > 0)) && (!sending || email.trim().length > 0);
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (consent && !otherAdultTypedNameIsValid(typedName)) { setNameError(true); return; }
      setSaving(true); setFailed(false);
      try {
        if (!(await signIfNeeded())) throw new Error("not_signed");
        if (sending) {
          const response = await fetch("/api/invitations", {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "content-type": "application/json", "x-inherit-csrf": target.operationToken ?? "" },
            body: JSON.stringify({ targetSubjectDraftId: target.subjectId, contactEmail: email.trim() }),
          });
          if (response.status !== 202) throw new Error("not_sent");
        }
        router.refresh();
      } catch { setFailed(true); setSaving(false); }
    }
    return card(<form onSubmit={submit} className="space-y-4">
      {consent ? <ConsentFields consent={consent} checked={checked} setChecked={setChecked} typedName={typedName}
        setTypedName={setTypedName} nameError={nameError} setNameError={setNameError} id={target.subjectId} /> : null}
      {sending ? <label className="block space-y-2">
        <span>{COPY.requestEmailLabel}</span>
        <Input name="contactEmail" type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
      </label> : null}
      {consent ? <p className="text-base">{consent.warning}</p> : null}
      {failed ? <p role="alert" className="text-sm text-danger">{sending ? COPY.sendFailed : COPY.signFailed}</p> : null}
      <Button type="submit" disabled={!ready || saving}>
        {saving ? COPY.saving : sending ? (consent ? COPY.signAndSendButton : COPY.sendButton) : COPY.signButton}
      </Button>
    </form>, sending ? "other-adult-request" : "other-adult-sign");
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
  return card(<>
    {latest ? <p role="status" className="text-sm">{latest}</p> : null}
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
  </>, "other-adult-ready");
}
