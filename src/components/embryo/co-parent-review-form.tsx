"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CoParentReview } from "@/lib/embryos/co-parent-review";
import { typedNameIsValid } from "@/lib/embryos/basis";
import { InvitationRefusalForm } from "./invitation-refusal-form";
import { Button } from "@/components/ui/button";
import { route } from "@/lib/primary-routes";

const STATEMENTS: Record<string, string> = {
  "genetic-parent-or-authority": "I am a genetic parent of these embryos, or I alone hold the legal right to decide what happens to them.",
  "no-outcome-data": "I understand that there is no outcome data, and that every number Inherit shows about an embryo is a simulation.",
  "future-person-charter": "I have read the Future Person Charter in full, and I accept that it is part of this consent.",
  "withdraw-any-time": "I can withdraw at any time without giving a reason. Inherit then stops all analysis of these embryos and deletes what it built from the files.",
  "genetic-parent-of-these-embryos": "I am a genetic parent of these embryos.",
  "other-parent-named-truthfully": "The other genetic parent is named truthfully on this record, or the reason no other parent can sign is stated truthfully.",
  "false-statement-warning-read": "I have read the warning about false statements at the end of this attestation, and I understand it.",
};

export function CoParentReviewForm({ review, countries, refusalNonce }: {
  review: CoParentReview;
  countries: { code: string; name: string }[];
  refusalNonce: string;
}) {
  const [status, setStatus] = useState<"ready" | "pending" | "accepted" | "failed">("ready");
  const [nameError, setNameError] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !review.acceptanceAvailable) return;
    const form = new FormData(event.currentTarget);
    const typedName = String(form.get("typedName") ?? "").trim();
    if (!typedNameIsValid(typedName)) { setNameError(true); return; }
    setNameError(false);
    const artifactBody = (key: string) => {
      const artifact = review.artifacts.find(item => item.artifact_key === key)!;
      return {
        artifactKey: key, artifactVersion: artifact.version,
        artifactPresentationToken: artifact.presentationToken,
        statementKeys: artifact.statementKeys, typedName, affirmed: true,
      };
    };
    submitting.current = true;
    setStatus("pending");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: review.nonce, jurisdictionCode: form.get("jurisdictionCode"),
          coParentArtifacts: {
            uploadEmbryo: artifactBody("consent.upload-embryo"),
            parentageAttestation: artifactBody("attestation.embryo-parentage"),
          },
        }),
      });
      if (!response.ok) { setStatus("failed"); return; }
      const receipt = await response.json();
      setStatus(receipt.status === "accepted" && receipt.participantState === "accepted_pending_cohort_finalization" ? "accepted" : "failed");
    } catch { setStatus("failed"); }
  }

  if (status === "accepted") return (
    <section className="mx-auto max-w-5xl px-6 py-16" role="status">
      <h1 className="display">You have accepted the invitation</h1>
      <p className="lede mt-5 text-ink">Your two signed statements are recorded. The group still needs to be finalized. This does not start analysis or share your own genome.</p>
      <p className="mt-3 text-sm">When the group is ready, collect your own Record Key Cards in Your data.</p>
      <a href={route("settings.data")} className="link-target quiet-link mt-4 text-sm">Go to Your data</a>
      <a href={route("app.overview")} className="link-target quiet-link mt-4 text-sm">Go to your overview</a>
    </section>
  );

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="display">Review this invitation before you sign</h1>
      <p className="lede mt-5 text-ink"><strong>{review.inviterName}</strong> signed the upload request for this group of {review.embryoCount} embryos.</p>
      <p className="mt-3 max-w-measure text-base leading-relaxed text-ink-muted">Only sign if you recognize this request and the people involved. Inherit cannot check parentage. Your own genome is not shared by accepting.</p>
      <p className="mt-3 text-sm"><a href={route("legal.future-person")} target="_blank" rel="noopener noreferrer" className="link-target quiet-link">Read the Future Person Charter (opens a new tab)</a></p>
      {!review.acceptanceAvailable ? <p className="surface-inset surface-pad mt-8 max-w-measure text-base leading-relaxed text-ink" role="status">{review.unavailableCopy}</p> : null}
      <form onSubmit={submit} className="stack-blocks mt-10">
        {review.artifacts.map(artifact => (
          <fieldset key={artifact.artifact_key} disabled={!review.acceptanceAvailable || status !== "ready"} className="surface surface-pad">
            <legend className="title px-2 text-ink">{artifact.artifact_key === "consent.upload-embryo" ? "Consent to the embryo upload" : "Your statement of parentage"}</legend>
            <p className="caption">Version {artifact.version} · effective {artifact.effective_on}</p>
            <p data-legal-summary className="mt-4 max-w-measure whitespace-pre-wrap text-base leading-relaxed text-ink">{artifact.summary_markdown}</p>
            <div className="mt-5 max-w-measure whitespace-pre-wrap border-t border-line pt-5 text-sm leading-relaxed text-ink">{artifact.body_markdown}</div>
            <p className="mono mt-5 break-all text-xs text-ink-muted">sha256 {artifact.body_sha256}</p>
            <div className="mt-6 space-y-4">
              {artifact.statementKeys.map(key => (
                <label key={key} className="flex min-h-11 max-w-measure items-start gap-3 text-base leading-relaxed text-ink">
                  <input type="checkbox" required name={`${artifact.artifact_key}:${key}`} className="mt-1.5 size-4 shrink-0 accent-forest" />
                  <span>{STATEMENTS[key]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset disabled={!review.acceptanceAvailable || status !== "ready"} className="surface surface-pad space-y-5">
          <legend className="title px-2 text-ink">Sign both statements</legend>
          <label className="label block text-ink">Country where you live
            <select required name="jurisdictionCode" defaultValue="" className="mt-2 block min-h-11 w-full max-w-md rounded-sm border border-line-strong bg-card px-3 py-2 text-base font-normal text-ink">
              <option value="" disabled>Choose your country</option>
              {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </label>
          <label className="label block text-ink">Full legal name
            <input required name="typedName" autoComplete="name" minLength={5} maxLength={200} aria-invalid={nameError} aria-describedby={nameError ? "name-error" : undefined} onChange={() => setNameError(false)} className="mt-2 block min-h-11 w-full max-w-md rounded-sm border border-line-strong bg-card px-3 py-2 text-base font-normal text-ink" />
          </label>
          {nameError ? <p id="name-error" role="alert" className="text-sm text-danger">Use at least two name parts with two or more characters each.</p> : null}
          <p className="caption max-w-measure">Typing your name signs both statements above. It does not grant permission to analyse the embryos; that is a separate agreement.</p>
          <div><Button type="submit" size="lg">{status === "pending" ? "Saving your statements…" : "Sign and accept invitation"}</Button></div>
        </fieldset>
        {status === "failed" ? <p role="alert" className="max-w-measure text-sm leading-relaxed text-ink">We could not confirm acceptance. This form may have expired or the invitation may have changed. <button type="button" onClick={() => window.location.reload()} className="prose-link cursor-pointer">Check the request again</button>.</p> : null}
      </form>
      <InvitationRefusalForm nonce={refusalNonce} />
    </section>
  );
}
