import { RECEIVED_BODY, RECEIVED_HEADING } from "@/copy/rights/future-person-claim";

/** The same non-enumerating receipt survives the server refresh that replaces
 * the start form with the live claim's document step. It grants no authority
 * and discloses nothing about any record or the submitted claim mode. */
export function ClaimStartReceipt() {
  return (
    <div role="status" className="rounded-2xl border border-line bg-card p-6">
      <h2 className="font-medium">{RECEIVED_HEADING}</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">{RECEIVED_BODY}</p>
    </div>
  );
}
