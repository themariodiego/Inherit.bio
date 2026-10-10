"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ADULT_UPLOAD_REVISION_COPY as COPY } from "@/copy/upload/other-adult";
import type { AdultUploadRevisionReview } from "@/lib/uploads/path-b-review";
import { day } from "./other-adult-lines";

type Operation = "confirm" | "refuse" | "delete";
type Status = "ready" | "pending" | Operation | "failed";

/**
 * One DNA file added for the person under the register's Path B, from the
 * rights session its upload-time notice opened: exactly what the uploader
 * can see, and three answers that need no account. Yes confirms only this
 * file; no deletes only this file; the third deletes everything.
 */
export function AdultUploadRevisionForm({ review }: { review: AdultUploadRevisionReview }) {
  const [status, setStatus] = useState<Status>("ready");
  const revision = review.revision;

  async function answer(operation: Operation) {
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation === "confirm"
          ? { operation, uploadRevisionAffirmed: true, nonce: review.nonce }
          : { operation, nonce: review.nonce }),
      });
      const receipt = await response.json().catch(() => null);
      setStatus(response.status === 202 && receipt?.status === "accepted" && receipt?.operation === operation
        ? operation : "failed");
    } catch { setStatus("failed"); }
  }

  if (status === "confirm" || status === "refuse" || status === "delete") return (
    <section className="rec-column rec-head px-6 py-16" role="status">
      <p className="eyebrow">Your rights</p>
      <h1 className="display">{COPY.receipts[status].title}</h1>
      <p className="lede">{COPY.receipts[status].body}</p>
    </section>
  );

  const busy = status === "pending";
  return (
    <section className="rec-column px-6 py-16" data-slot="adult-upload-revision">
      <header className="rec-head">
        <p className="eyebrow">Your rights</p>
        <h1 className="display">{COPY.heading}</h1>
      </header>
      <div className="surface surface-pad rec-stack mt-10">
        <p className="max-w-measure">{COPY.added(day(revision.addedOn), revision.fileKind)}</p>
        <p className="max-w-measure text-sm leading-relaxed">{COPY.uploader(revision.uploaderName)}</p>
        <div>
          <h2 className="title">{COPY.seeHeading}</h2>
          <p className="mt-2 max-w-measure text-sm leading-relaxed text-ink-muted">{COPY.see(revision.label)}</p>
        </div>
        {revision.state === "pending" ? <>
          <p className="max-w-measure text-sm leading-relaxed">{COPY.nothingYet}</p>
          <p className="max-w-measure text-sm leading-relaxed text-ink-muted">{COPY.deadline(day(revision.deleteBy))}</p>
          <div><Button type="button" disabled={busy} onClick={() => void answer("confirm")}>
            {busy ? COPY.saving : COPY.confirmButton}</Button></div>
        </> : <p role="status" className="max-w-measure text-sm leading-relaxed">{COPY.confirmedOn(day(revision.confirmedOn))}</p>}
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void answer("refuse")}>{COPY.refuseButton}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void answer("delete")}>{COPY.deleteButton}</Button>
        </div>
        <p className="max-w-measure text-sm text-ink-muted">{COPY.deleteDetail}</p>
        <p className="max-w-measure text-sm text-ink-muted">{COPY.contact}</p>
        {status === "failed" ? <p role="alert" className="text-sm">{COPY.failed}</p> : null}
      </div>
    </section>
  );
}
