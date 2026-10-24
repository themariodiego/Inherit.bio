"use client";

import { useState } from "react";
import Link from "next/link";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADULT_SUBJECT_STATEMENTS_HEADING } from "@/copy/family/adult-subject-statements";
import { PATH_B_REQUEST_COPY } from "@/copy/upload/other-adult";
import type { AdultSubjectReview } from "@/lib/embryos/adult-subject-review";
import { route } from "@/lib/primary-routes";
import { otherAdultTypedNameIsValid } from "@/lib/uploads/other-adult-upload";

/**
 * The three answers to an adult-subject invitation, from the rights session
 * its mailed link opened. The copy is the copy the mailed-token page already
 * used for the same three outcomes; only the way the authority arrives has
 * changed.
 *
 * Accepting (D-103): the five signed statements the server published, each
 * its own checkbox named by its sentence, and the person's typed name (owner
 * decision of 23 October 2026), with the label and rule Path B's own
 * signature uses. Accept stays disabled until every statement is ticked and
 * the name has two parts of two characters or more, and the body carries
 * only the keys that are ticked, so it names the published list exactly
 * when, and only when, all five are. It goes to api.invitation-accept, the
 * route the register names for Path A, with that route's session token;
 * refusing and deleting stay on api.withdraw with its own. The statements
 * and the name render only for the account that may accept; signed out, the
 * page is the one it was.
 */

type Operation = "confirm" | "refuse" | "delete";
type Outcome = "accepted" | "refused" | "deleted";
type Status = "ready" | "pending" | Outcome | "failed";

/** The registered receipt carries the operation, never a target or a state. */
const OUTCOME_OF: Record<Operation, Outcome> = {
  confirm: "accepted", refuse: "refused", delete: "deleted",
};

const RECEIPTS: Record<Outcome, { title: string; body: string }> = {
  accepted: {
    title: "Invitation accepted",
    body: "The reserved subject now belongs to your account. The inviter received no genetic-data access.",
  },
  refused: {
    title: "Invitation refused",
    body: "The reserved subject was closed. This address will not receive another invitation for this target.",
  },
  deleted: {
    title: "Reserved record deleted",
    body: "The empty reserved subject was closed. No genetic file or derived result existed for it.",
  },
};

export function AdultSubjectReviewForm({ review }: { review: AdultSubjectReview }) {
  const [status, setStatus] = useState<Status>("ready");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const confirmation = review.acceptanceBlockedBy === null ? review.confirmation : null;
  const allTicked = confirmation !== null
    && confirmation.statements.every(statement => ticked[statement.key] === true);
  const nameValid = otherAdultTypedNameIsValid(typedName);
  const rights = useCsrf("api.withdraw");
  const accept = useCsrf("api.invitation-accept");

  /** Accepting: api.invitation-accept's adult body and its invitation-accepted-v1 answer. */
  async function confirm() {
    if (status !== "ready" || !confirmation || !allTicked || !nameValid) return;
    setStatus("pending");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Inherit-CSRF": accept.value() },
        body: JSON.stringify({
          nonce: confirmation.nonce,
          subjectArtifact: {
            artifactKey: "consent.subject-adult",
            artifactVersion: review.artifact.version,
            artifactPresentationToken: confirmation.presentationToken,
            affirmed: true,
            statementKeys: confirmation.statements.filter(statement => ticked[statement.key] === true)
              .map(statement => statement.key),
            typedName: typedName.trim(),
          },
        }),
      });
      accept.accept(response);
      const body = await response.json().catch(() => null);
      if (response.status !== 200 || body?.invitationKind !== "adult_subject" || body?.status !== "accepted") {
        setStatus("failed");
        return;
      }
      setStatus("accepted");
    } catch { setStatus("failed"); }
  }

  /** Refusing and deleting: api.withdraw's `{operation, nonce}` and its rights-operation-accepted-v1 receipt. */
  async function answer(operation: Exclude<Operation, "confirm">) {
    if (status !== "ready") return;
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Inherit-CSRF": rights.value() },
        body: JSON.stringify({ operation, nonce: review.nonce }),
      });
      rights.accept(response);
      const body = await response.json().catch(() => null);
      if (response.status !== 202 || body?.status !== "accepted" || body?.operation !== operation) {
        setStatus("failed");
        return;
      }
      setStatus(OUTCOME_OF[operation]);
    } catch { setStatus("failed"); }
  }

  const receipt = status === "accepted" || status === "refused" || status === "deleted"
    ? RECEIPTS[status] : null;
  if (receipt) return (
    <section className="mx-auto max-w-3xl px-6 py-16" role="status">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4">{receipt.title}</h1>
      <p className="lede mt-5">{receipt.body}</p>
      {status === "accepted" ? (
        <Link href={route("settings.people")} className="link-target quiet-link mt-4 text-sm">
          Open people settings
        </Link>
      ) : null}
    </section>
  );

  const busy = status === "pending";
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4">Review invitation</h1>
      <div className="surface surface-pad mt-10 space-y-6">
        <div>
          <h2 className="title text-ink">No genetic data has been shared</h2>
          <p className="mt-3 max-w-measure text-base leading-relaxed text-ink-muted">
            Accepting creates a reserved subject under your account. It does
            not give the sender access, permission to upload, or permission
            to analyse your genetic data.
          </p>
        </div>
        <div className="surface-inset surface-pad-sm">
          <h3 className="label text-ink">What you agree to</h3>
          <p className="caption mt-2">
            Version {review.artifact.version} · effective {review.artifact.effectiveOn}
          </p>
          <p data-legal-summary className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
            {review.artifact.summaryMarkdown}
          </p>
          <div className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-sm leading-relaxed">
            {review.artifact.bodyMarkdown}
          </div>
          <p className="mono mt-4 break-all text-xs text-ink-muted">
            sha256 {review.artifact.bodySha256}
          </p>
        </div>
        {busy ? <p role="status" aria-live="polite" data-state="processing" className="text-sm text-ink-muted">Saving your choice…</p> : null}
        {review.acceptanceBlockedBy === "sign-in" ? (
          <Button asChild size="lg">
            <Link href={route("auth.sign-in", { query: { next: "/withdraw/session" } })}>Sign in to accept</Link>
          </Button>
        ) : review.acceptanceBlockedBy === "other-account" ? (
          <p role="status" className="max-w-measure text-base leading-relaxed text-ink-muted">
            This invitation was sent to a different address. Sign in with the
            address that received it to accept. You can still refuse or delete
            the reserved record from here.
          </p>
        ) : confirmation ? (
          <>
            <fieldset disabled={busy} className="space-y-4" data-slot="adult-subject-statements">
              <legend className="label text-ink">{ADULT_SUBJECT_STATEMENTS_HEADING}</legend>
              {confirmation.statements.map(statement => (
                <label key={statement.key} className="flex min-h-11 max-w-measure items-start gap-3 text-base leading-relaxed text-ink">
                  <input type="checkbox" name={statement.key} checked={ticked[statement.key] === true}
                    onChange={event => {
                      const checked = event.target.checked;
                      setTicked(current => ({ ...current, [statement.key]: checked }));
                    }}
                    className="mt-1.5 size-4 shrink-0 accent-forest" />
                  <span>{statement.text}</span>
                </label>
              ))}
            </fieldset>
            <div className="max-w-md space-y-2">
              <Label htmlFor="adult-subject-typed-name">{PATH_B_REQUEST_COPY.typedNameLabel}</Label>
              <Input id="adult-subject-typed-name" name="typedName" autoComplete="name" maxLength={200}
                value={typedName} disabled={busy} aria-describedby="adult-subject-typed-name-rule"
                aria-invalid={typedName.trim().length > 0 && !nameValid}
                onChange={event => setTypedName(event.target.value)} />
              <p id="adult-subject-typed-name-rule" className="caption">{PATH_B_REQUEST_COPY.typedNameError}</p>
            </div>
            <Button type="button" size="lg" disabled={busy || !allTicked || !nameValid} onClick={() => confirm()}>
              {busy ? "Saving your choice…" : "Accept through my account"}
            </Button>
          </>
        ) : null}
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <Button type="button" variant="outline" disabled={busy} onClick={() => answer("refuse")}>
            Refuse
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => answer("delete")}>
            Delete reserved record
          </Button>
        </div>
        {status === "failed" ? (
          <p role="alert" className="max-w-measure text-sm leading-relaxed text-ink">
            We could not record your choice. This form may have expired, or the
            invitation may already have been answered.{" "}
            <button type="button" onClick={() => window.location.reload()} className="prose-link cursor-pointer">
              Check this invitation again
            </button>.
          </p>
        ) : null}
      </div>
    </section>
  );
}
