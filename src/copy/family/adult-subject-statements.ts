/**
 * D-103: the five statements an invited adult ticks, one at a time, before
 * accepting an invitation through their own account (Path A, on
 * `/withdraw/session`).
 *
 * SIGNED COPY. The owner approved the first four verbatim on 14 September
 * 2026 and signed the split `revocable` sentence on 23 October 2026
 * (docs/protocol/copy-for-signature.md, "D-103"; docs/protocol/decisions.md,
 * "D-103: the owner signs the split `revocable` sentence"). No word, letter
 * case or punctuation mark changes without a new signature;
 * `adult-subject-statements.test.ts` pins every byte.
 *
 * The keys are the ones the acceptance transaction records on the signature
 * (`private.adult_subject_invitation_response_v1`, `statement_keys`), in the
 * same order. The server publishes exactly this list with the page and
 * refuses a confirm body that names any other.
 *
 * The readability gate measures them here as ordinary copy: block role, so a
 * block of 15 words or more is held to grade 9. A consent statement is not
 * legal copy for the gate (owner decision, 23 October 2026).
 */

export type AdultSubjectStatementKey =
  | "age-18-plus"
  | "mailbox-control"
  | "no-inviter-access"
  | "identity-not-verified"
  | "revocable";

export interface AdultSubjectStatement {
  readonly key: AdultSubjectStatementKey;
  readonly text: string;
}

export const ADULT_SUBJECT_STATEMENTS = [
  { key: "age-18-plus", text: "I am 18 or older." },
  { key: "mailbox-control", text: "This email address is mine, and I am the only person who reads it." },
  {
    key: "no-inviter-access",
    text: "The person who invited me cannot make this decision for me, and cannot see what I choose until I choose it.",
  },
  { key: "identity-not-verified", text: "Inherit has not checked who I am. It knows only that I can read this mailbox." },
  {
    key: "revocable",
    text: "I can take this back at any time. Inherit then deletes what was built from my file, on the deadlines it publishes.",
  },
] as const satisfies readonly AdultSubjectStatement[];

/** The legend above the five checkboxes. */
export const ADULT_SUBJECT_STATEMENTS_HEADING = "Confirm each of these";
