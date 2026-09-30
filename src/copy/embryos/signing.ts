/**
 * The signed statements of the embryo upload, and the words around them
 * (design §2.2 steps 2–4; contract §2 statement keys in
 * src/lib/embryos/basis.ts). Every statement key an embryo artifact
 * publishes has exactly one sentence here; `src/copy/embryos/embryos.test.ts`
 * fails if a key has none. The artifact's own text is always shown in full
 * above its statements, so each sentence says what the person agrees to in
 * plain words and never adds a promise the artifact does not make.
 *
 * Export names carry the readability role (scripts/readability-gate.ts).
 */

/** One sentence per published statement key, across every embryo artifact. */
export const STATEMENT_SENTENCES: Readonly<Record<string, string>> = {
  // consent.upload-embryo, signed by a genetic parent.
  "genetic-parent-or-authority":
    "I am a genetic parent of these embryos, or I alone hold the legal right to decide what happens to them.",
  "no-outcome-data":
    "There is no outcome data. I understand that every number Inherit shows about an embryo is a simulation.",
  "future-person-charter":
    "I have read the Future Person Charter in full, and I accept that it is part of this consent.",
  "withdraw-any-time":
    "I can withdraw at any time without giving a reason. Inherit then stops all analysis of these embryos and deletes what it built from the files.",
  // consent.upload-embryo, signed by someone who is not a genetic parent.
  "uploader-right-to-files": "I have the right to send Inherit these files.",
  "not-a-genetic-parent": "I am not a genetic parent of these embryos.",
  "parents-permission-held": "Both genetic parents have given me permission, and I can show it if asked.",
  // attestation.embryo-parentage.
  "genetic-parent-of-these-embryos": "I am a genetic parent of these embryos.",
  "other-parent-named-truthfully":
    "I named the other genetic parent truthfully. If no other parent can sign, I gave the true reason.",
  "false-statement-warning-read":
    "I have read the warning about false statements. I understand it.",
  // attestation.embryo-disposition-rights.
  "right-to-decide-disposition": "I have the right to decide what happens to these embryos.",
  "no-dispute-or-proceeding": "No dispute or court case about these embryos is under way that I know of.",
  "objection-stops-and-deletes":
    "If the other genetic parent objects, Inherit stops and deletes what it built from these files.",
  // attestation.embryo-single-parent-basis.
  "basis-is-true": "What I said about why only one parent can sign is true.",
  "evidence-is-genuine": "Any document I send to show it is genuine.",
  "objection-stops-analysis": "If someone with a right to object does, Inherit stops the analysis.",
  // charter.future-person.
  "read-in-full": "I have read the Future Person Charter in full.",
  "rights-are-enforceable": "I understand that the rights in the Charter can be enforced.",
  // disclosure.insurance-and-discrimination.
  understood: "I have read this and I understand it.",
  // The embryo.analysis grant, signed against consent.upload-embryo.
  "one-purpose": "This lets Inherit read these embryo files for one purpose: to show you their results.",
  "every-parent-must-agree": "Results show only when every genetic parent has turned them on.",
  "pause-or-stop-any-time": "I can pause or stop this at any time.",
};

/** Each artifact's heading on a signing screen. */
export const ARTIFACT_HEADINGS: Readonly<Record<string, string>> = {
  "consent.upload-embryo": "Consent to the embryo upload",
  "attestation.embryo-parentage": "Your statement as a parent",
  "attestation.embryo-disposition-rights": "Your right to decide for these embryos",
  "attestation.embryo-single-parent-basis": "Why only one parent can sign",
  "charter.future-person": "The Future Person Charter",
  "disclosure.insurance-and-discrimination": "Insurance and discrimination",
};

/** The typed-name field of every signing form. */
export const TYPED_NAME_LABEL = "Full legal name";

/** What typing the name does, stated under the field. */
export const TYPED_NAME_NOTE = "Typing your name signs every statement above.";

/** A typed name that is too short. */
export const TYPED_NAME_ERROR_STATUS = "Use at least two name parts with two or more characters each.";

/** The signing form's one primary action, and while it is working. */
export const SIGN_BUTTON = "Sign";
export const SIGNING_STATUS = "Saving your signature…";

/** A signing, sending or checking request that did not go through. */
export const REQUEST_FAILED_STATUS =
  "This did not go through. The page may have expired, or something changed. Load the page again to see where things stand.";

/** Where a person can read the artifact's own version details. */
export function artifactVersionNote(version: number, effectiveOn: string): string {
  return `Version ${version} · in force from ${effectiveOn}`;
}
