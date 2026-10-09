"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AdultSubjectReview } from "@/lib/embryos/adult-subject-review";
import { route } from "@/lib/primary-routes";

/**
 * The three answers to an adult-subject invitation, from the rights session
 * its mailed link opened. The copy is the copy the mailed-token page already
 * used for the same three outcomes; only the way the authority arrives has
 * changed.
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

  async function answer(operation: Operation) {
    if (status !== "ready") return;
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, nonce: review.nonce }),
      });
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
        ) : (
          <Button type="button" size="lg" disabled={busy} onClick={() => answer("confirm")}>
            {busy ? "Saving your choice…" : "Accept through my account"}
          </Button>
        )}
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
