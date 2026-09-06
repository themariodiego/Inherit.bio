"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CoParentReview } from "@/lib/embryos/co-parent-review";
import { typedNameIsValid } from "@/lib/embryos/basis";
import { InvitationRefusalForm } from "./invitation-refusal-form";

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
      <h1 className="display text-4xl">You have accepted the invitation</h1>
      <p className="mt-5 max-w-prose">Your two signed statements are recorded. The group still needs to be finalized. This does not start analysis or share your own genome.</p>
      <a href="/overview" className="mt-6 inline-block text-forest underline">Go to your overview</a>
    </section>
  );

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="display text-4xl">Review this invitation before you sign</h1>
      <p className="mt-5 max-w-prose"><strong>{review.inviterName}</strong> signed the upload request for this group of {review.embryoCount} embryos.</p>
      <p className="mt-3 max-w-prose text-ink-muted">Only sign if you recognize this request and the people involved. Inherit cannot check parentage. Your own genome is not shared by accepting.</p>
      <p className="mt-3"><a href="/legal/future-person" target="_blank" rel="noopener noreferrer" className="text-forest underline">Read the Future Person Charter (opens a new tab)</a></p>
      {!review.acceptanceAvailable ? <p className="mt-6 rounded-2xl border border-line p-5" role="status">{review.unavailableCopy}</p> : null}
      <form onSubmit={submit} className="mt-8 space-y-8">
        {review.artifacts.map(artifact => (
          <fieldset key={artifact.artifact_key} disabled={!review.acceptanceAvailable || status !== "ready"} className="rounded-2xl border border-line bg-card p-6">
            <legend className="px-2 text-xl font-medium">{artifact.artifact_key === "consent.upload-embryo" ? "Consent to the embryo upload" : "Your statement of parentage"}</legend>
            <p className="text-sm text-ink-muted">Version {artifact.version} · effective {artifact.effective_on}</p>
            <p data-legal-summary className="mt-4 whitespace-pre-wrap">{artifact.summary_markdown}</p>
            <div className="mt-5 whitespace-pre-wrap border-t border-line pt-5 text-sm leading-relaxed">{artifact.body_markdown}</div>
            <p className="mt-5 break-all font-mono text-xs text-ink-muted">sha256 {artifact.body_sha256}</p>
            <div className="mt-6 space-y-4">
              {artifact.statementKeys.map(key => (
                <label key={key} className="flex min-h-11 items-start gap-3">
                  <input type="checkbox" required name={`${artifact.artifact_key}:${key}`} className="mt-1 size-5 shrink-0 accent-forest" />
                  <span>{STATEMENTS[key]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset disabled={!review.acceptanceAvailable || status !== "ready"} className="space-y-5">
          <legend className="text-xl font-medium">Sign both statements</legend>
          <label className="block">Country where you live
            <select required name="jurisdictionCode" defaultValue="" className="mt-2 block min-h-11 w-full max-w-md rounded-lg border border-line bg-card p-3">
              <option value="" disabled>Choose your country</option>
              {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </label>
          <label className="block">Full legal name
            <input required name="typedName" autoComplete="name" minLength={5} maxLength={200} aria-invalid={nameError} aria-describedby={nameError ? "name-error" : undefined} onChange={() => setNameError(false)} className="mt-2 block min-h-11 w-full max-w-md rounded-lg border border-line bg-card p-3" />
          </label>
          {nameError ? <p id="name-error" role="alert">Use at least two name parts with two or more characters each.</p> : null}
          <p className="max-w-prose text-sm text-ink-muted">Typing your name signs both statements above. It does not grant permission to analyse the embryos; that is a separate agreement.</p>
          <button type="submit" className="min-h-11 rounded-full bg-forest px-6 py-3 text-on-forest">{status === "pending" ? "Saving your statements…" : "Sign and accept invitation"}</button>
        </fieldset>
        {status === "failed" ? <p role="alert">We could not confirm acceptance. This form may have expired or the invitation may have changed. <button type="button" onClick={() => window.location.reload()} className="min-h-11 text-forest underline">Check the request again</button>.</p> : null}
      </form>
      <InvitationRefusalForm nonce={refusalNonce} />
    </section>
  );
}
