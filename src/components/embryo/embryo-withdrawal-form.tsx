"use client";

import { useState } from "react";
import { EMBRYO_WITHDRAWAL_COPY as COPY } from "@/copy/rights/embryo-withdrawal";
import type { EmbryoWithdrawalOperation, RightsEmbryoWithdrawal } from "@/lib/embryos/embryo-parent-withdrawal";

/**
 * `rightsEmbryoWithdrawal`: the read-only view of what the uploader can see,
 * and the actions this rights session may take. Each action is one click and
 * needs no account; the page says, before either button, that both end every
 * use of the records and cannot be undone.
 */

type Status = "ready" | "pending" | EmbryoWithdrawalOperation | "failed";

export function EmbryoWithdrawalForm({ view, nonce }: { view: RightsEmbryoWithdrawal; nonce: string }) {
  const [status, setStatus] = useState<Status>("ready");

  async function act(operation: EmbryoWithdrawalOperation) {
    if (status !== "ready" && status !== "failed") return;
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, nonce }),
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 202 || body?.status !== "accepted" || body?.operation !== operation) {
        setStatus("failed");
        return;
      }
      setStatus(operation);
    } catch { setStatus("failed"); }
  }

  if (status === "refuse" || status === "delete") {
    const receipt = COPY.receipts[status];
    return (
      <section className="mx-auto max-w-3xl px-6 py-16" role="status" data-slot="embryo-withdrawal-receipt">
        <p className="eyebrow">{COPY.eyebrow}</p>
        <h1 className="display mt-4 text-4xl">{receipt.title}</h1>
        <p className="mt-5 max-w-prose text-ink-muted">{receipt.body}</p>
      </section>
    );
  }

  const busy = status === "pending";
  return (
    <section className="mx-auto max-w-3xl px-6 py-16" data-slot="embryo-withdrawal">
      <p className="eyebrow">{COPY.eyebrow}</p>
      <h1 className="display mt-4 text-4xl">{COPY.title}</h1>
      <p className="mt-5 max-w-prose text-ink-muted">{COPY.intro}</p>
      <div className="mt-8 space-y-6 rounded-2xl border border-line bg-card p-6">
        <div>
          <h2 className="font-medium">{view.cohortSafeLabel}</h2>
          <p className="mt-1 text-sm text-ink-muted">{COPY.countLine(view.embryoCount)}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium">{COPY.statusHeading}</h3>
          <ul className="mt-2 space-y-1 text-sm" data-slot="embryo-withdrawal-statuses">
            {view.safeStatusLabels.map((label, index) => (
              <li key={index}>{`Embryo ${index + 1}: ${label}`}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">{COPY.purposesHeading}</h3>
          {view.currentPurposeLabels.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {view.currentPurposeLabels.map((label) => <li key={label}>{label}</li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-muted">{COPY.noPurposes}</p>}
        </div>
        <p className="text-sm text-ink-muted">{COPY.findingsLine}</p>
        <p className="text-sm text-ink-muted">{COPY.retentionLine(view.retentionMaximumDays)}</p>
      </div>
      {view.allowedActionIds.length ? (
        <div className="mt-8">
          <h2 className="text-xl font-medium">{COPY.actionsHeading}</h2>
          <p className="mt-3 max-w-prose text-sm text-ink-muted">{COPY.effect}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {view.allowedActionIds.map((operation) => (
              <div key={operation} className="max-w-xs">
                <button
                  type="button" disabled={busy} onClick={() => act(operation)}
                  className={operation === "delete"
                    ? "min-h-11 rounded-full bg-forest px-6 py-3 text-on-forest disabled:opacity-60"
                    : "min-h-11 rounded-full border border-line px-6 py-3 text-ink disabled:opacity-60"}
                >
                  {COPY.actions[operation].label}
                </button>
                <p className="mt-2 text-xs text-ink-muted">{COPY.actions[operation].help}</p>
              </div>
            ))}
          </div>
          {status === "failed" ? <p role="alert" className="mt-4 max-w-prose text-sm">{COPY.failed}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
