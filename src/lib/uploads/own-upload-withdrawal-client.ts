import type { CsrfHandle } from "@/lib/security/session-csrf-client";

/**
 * The browser half of withdrawing the consent to store one's own DNA file
 * (owner decision of 19 November 2026, "Withdrawing consent for a person's
 * own DNA file deletes the files and all made from them"): the view a page
 * hands the control, the control's steps, and the one request it sends. The
 * server half is `own-upload-withdrawal.ts`.
 */

/** Why the control can or cannot run now, from the page's read of the database. */
export type OwnUploadWithdrawalReadiness = "ready" | "processing" | "unsupported" | "unavailable";

export type OwnUploadWithdrawalView =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "live";
      /** The account's own record, the route subject the request names. */
      subjectId: string;
      /** When the live upload consent was signed, and which version. */
      signedAt: string;
      version: number;
      readiness: OwnUploadWithdrawalReadiness;
      /** The one-time code for `api.subject-delete` and this record; only when the request can run. */
      nonce: string | null;
    }>;

/**
 * What an answer means. Only 202 is a withdrawal: the route answers it after
 * the database committed. A 4xx is a refusal (the route's opaque 404, the
 * token's 403, sign-in's 401), and a refusal committed nothing. Anything
 * else, or no answer, cannot say whether the withdrawal committed.
 */
export type WithdrawalOutcome = "withdrawn" | "refused" | "uncertain";

export function withdrawalOutcome(status: number | null): WithdrawalOutcome {
  if (status === 202) return "withdrawn";
  if (status !== null && status >= 400 && status < 500) return "refused";
  return "uncertain";
}

/**
 * The self case of `api.subject-delete`: `DELETE /api/subjects/[id]` with no
 * body, the one-time code the page rendered for that route and this record in
 * `X-Inherit-Operation-Nonce`, and the route's one-time session token in
 * `X-Inherit-CSRF` through the token chain.
 */
export async function requestOwnUploadWithdrawal(csrf: CsrfHandle, subjectId: string, nonce: string): Promise<WithdrawalOutcome> {
  try {
    const response = await csrf.send((csrfToken) => fetch(`/api/subjects/${subjectId}`, {
      method: "DELETE",
      headers: { "X-Inherit-CSRF": csrfToken, "X-Inherit-Operation-Nonce": nonce },
    }));
    return withdrawalOutcome(response.status);
  } catch {
    return withdrawalOutcome(null);
  }
}

/** The control's steps: the trigger, the confirmation, the request in flight, the receipt. */
export type WithdrawalPhase = "idle" | "confirming" | "sending" | "done";
export type WithdrawalState = Readonly<{ phase: WithdrawalPhase; failure: Exclude<WithdrawalOutcome, "withdrawn"> | null }>;
export type WithdrawalEvent =
  | Readonly<{ type: "open" }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "send" }>
  | Readonly<{ type: "answered"; outcome: WithdrawalOutcome }>;

export const WITHDRAWAL_START: WithdrawalState = Object.freeze({ phase: "idle", failure: null });

/**
 * Only the confirmation sends: "send" changes nothing unless the confirmation
 * is open, and the request is made only after it has. A receipt is final.
 */
export function withdrawalStep(state: WithdrawalState, event: WithdrawalEvent): WithdrawalState {
  if (state.phase === "done") return state;
  switch (event.type) {
    case "open": return state.phase === "idle" ? { phase: "confirming", failure: null } : state;
    case "cancel": return state.phase === "confirming" ? { phase: "idle", failure: state.failure } : state;
    case "send": return state.phase === "confirming" ? { phase: "sending", failure: null } : state;
    case "answered":
      if (state.phase !== "sending") return state;
      return event.outcome === "withdrawn" ? { phase: "done", failure: null } : { phase: "idle", failure: event.outcome };
  }
}
