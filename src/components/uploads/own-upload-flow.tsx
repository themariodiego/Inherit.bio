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
import type { OwnUploadLimits } from "@/lib/uploads/subject-upload-contract";
import { OWN_UPLOAD_COPY as COPY } from "@/copy/upload/consent";

export function OwnUploadFlow({ view, limits = null }: { view: OwnUploadView; limits?: OwnUploadLimits | null }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (view.kind === "unavailable" || view.kind === "underage") {
    return <p role="status">{view.kind === "underage" ? COPY.underage : COPY.unavailable}</p>;
  }
  if (view.kind === "ready") return <Uploader subjectId={view.subjectId} limits={limits} />;

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
  // Every signature refreshes, the own-DNA one included, and the picker below
  // stays shut until that refresh has landed. The two halves are one fix and
  // neither works alone.
  //
  // This component is keyed on the presented token, so the first refresh after
  // signing remounts it. Skipping the refresh at signing time did not avoid
  // that remount, it postponed it to the `router.refresh()` at the end of
  // preparation - where it destroyed the uploader's finished state, wiping
  // "Your file is stored and prepared" and its two links moments after they
  // appeared and returning the person to what looks like an untouched picker,
  // with nothing on the page saying their genome file had been stored.
  //
  // Refreshing here is not enough on its own, which was checked rather than
  // assumed: with the picker still enabled by a local flag the moment the
  // signature returns, a file can be chosen inside the window before the
  // refresh lands, and the remount then arrives DURING the upload instead of
  // after it. Three browser specs failed that way. So the enabled state comes
  // from the server view - the `ready` branch above - which puts the one
  // remount at the only moment nothing is in flight, and leaves the key stable
  // from then on.
  //
  // The cost is named: if a signature is recorded but its refresh fails, the
  // person is left with a saved permission and a picker that will not open
  // until they reload. That is recoverable and visible; a remount part-way
  // through a genome upload is neither.
  const sign = () => submit(route("api.consents"), {
    action: "sign-artifact", signatureClass: "tier1-self", subjectId: view.subjectId,
    artifactVersion: view.artifact.version, artifactPresentationToken: view.token, affirmed: true,
    statementKeys: [...OWN_UPLOAD_STATEMENTS[view.artifact.key]],
  }, view.token, true);
  return <section className="space-y-5 rounded-2xl border border-line bg-card p-6">
    <h2 className="display text-2xl">{own ? COPY.ownHeading : COPY.insuranceHeading}</h2>
    <p className="text-sm text-ink-muted">Version {view.artifact.version}</p>
    <p data-legal-summary className="text-sm">{view.artifact.summary}</p>
    <div className="whitespace-pre-wrap text-sm leading-relaxed">{view.artifact.body}</div>
    <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={checked}
      disabled={pending || saved} className="mt-1 size-5" onChange={event => {
        setChecked(event.target.checked);
        if (own && event.target.checked) void sign();
      }} /><span>{own ? COPY.ownCheckbox : COPY.insuranceCheckbox}</span></label>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {saved ? <p role="status" className="text-sm">{COPY.saved}</p> : null}
    {own ? <Uploader subjectId={view.subjectId} limits={limits} disabled /> : <Button onClick={() => void sign()}
      disabled={!checked || pending || saved}>{pending ? COPY.saving : COPY.insuranceContinue}</Button>}
  </section>;
}
