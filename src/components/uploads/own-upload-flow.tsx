"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Uploader } from "./uploader";
import { route } from "@/lib/primary-routes";
import { OWN_UPLOAD_STATEMENTS } from "@/lib/uploads/own-consent";
import { isAdultOnUtcDate } from "@/lib/uploads/account-completion";
import type { OwnUploadView } from "@/lib/uploads/own-upload-view";
import { OWN_UPLOAD_COPY as COPY } from "@/copy/upload/consent";

export function OwnUploadFlow({ view }: { view: OwnUploadView }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (view.kind === "unavailable" || view.kind === "underage") {
    return <p role="status">{view.kind === "underage" ? COPY.underage : COPY.unavailable}</p>;
  }
  if (view.kind === "ready") return <Uploader subjectId={view.subjectId} />;

  async function submit(path: string, body: unknown, token: string, refresh: boolean) {
    setPending(true); setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers: {
        "content-type": "application/json", "x-inherit-csrf": token,
      }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("not_saved");
      setSaved(true);
      if (refresh) router.refresh();
    } catch { setError(COPY.failed); setChecked(false); }
    finally { setPending(false); }
  }
  if (view.kind === "account-completion") {
    return <form className="space-y-4 rounded-2xl border border-line bg-card p-6" onSubmit={async event => {
      event.preventDefault();
      const dateOfBirth = String(new FormData(event.currentTarget).get("dateOfBirth") ?? "");
      if (!isAdultOnUtcDate(dateOfBirth)) { setError(COPY.adultRequired); return; }
      await submit(route("api.account-completion"), { dateOfBirth, presentationToken: view.token }, view.token, true);
    }}>
      <h2 className="display text-2xl">{COPY.accountHeading}</h2>
      <p className="text-sm text-ink-muted">{COPY.accountDetail}</p>
      <label className="block space-y-2"><span>{COPY.birthDateLabel}</span>
        <Input type="date" name="dateOfBirth" autoComplete="bday" required disabled={pending || saved} />
      </label>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Button type="submit" disabled={pending || saved}>{pending ? COPY.saving : COPY.accountContinue}</Button>
    </form>;
  }
  // Both state variants above returned; this is one explicitly presented artifact.
  const own = view.artifact.key === "consent.upload-self";
  const sign = () => submit(route("api.consents"), {
    action: "sign-artifact", signatureClass: "tier1-self", subjectId: view.subjectId,
    artifactVersion: view.artifact.version, artifactPresentationToken: view.token, affirmed: true,
    statementKeys: [...OWN_UPLOAD_STATEMENTS[view.artifact.key]],
  }, view.token, !own);
  return <section className="space-y-5 rounded-2xl border border-line bg-card p-6">
    <h2 className="display text-2xl">{own ? COPY.ownHeading : COPY.insuranceHeading}</h2>
    <p className="text-sm text-ink-muted">Version {view.artifact.version}</p>
    <p data-legal-summary className="text-sm">{view.artifact.summary}</p>
    <div className="whitespace-pre-wrap text-sm leading-relaxed">{view.artifact.body}</div>
    <label className="flex items-start gap-3"><input type="checkbox" checked={checked}
      disabled={pending || saved} className="mt-1 size-5" onChange={event => {
        setChecked(event.target.checked);
        if (own && event.target.checked) void sign();
      }} /><span>{own ? COPY.ownCheckbox : COPY.insuranceCheckbox}</span></label>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {saved ? <p role="status" className="text-sm">{COPY.saved}</p> : null}
    {own ? <Uploader subjectId={view.subjectId} disabled={!saved || pending} /> : <Button onClick={() => void sign()}
      disabled={!checked || pending || saved}>{pending ? COPY.saving : COPY.insuranceContinue}</Button>}
  </section>;
}
