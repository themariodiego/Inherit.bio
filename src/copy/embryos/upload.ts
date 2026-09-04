/**
 * `/embryos/upload` — the five-step flow (design §2.2; brief §2 §6.1 lines
 * 374-377, §3 §6 lines 980-991, §5 §2.8 lines 1729-1735, X6.1, brief line
 * 1083). Every user-visible string of that page lives here: typographic
 * apostrophes (U+2019), sentence case, second person, grade ≤ 9, no
 * sentence over 25 words.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_HEADING` is read as a heading, `*_LABEL` as a label, `*_BUTTON` as a
 * button, `*_STATUS` and `*_NOTE` as statuses; the `label` of every option
 * table is checked as a label by src/copy/embryos/embryos.test.ts. Short
 * roles use only words registered in data/plain-vocabulary.json and never
 * a term from data/jargon.json, except where the brief fixes the wording.
 *
 * Strings the brief quotes ship character-for-character. The option ids are
 * the register's own enums (`requestSchemas.closed-embryo-cohort-draft-v1`:
 * `uploadSituation`, `basis`), so the flow's answers are the request body's
 * values and nothing is translated later.
 */
import { INGEST_REFUSALS } from "@/copy/upload/errors";
import { REQUEST_DATA_BUTTON } from "./index";
import { BACK_TO_EMBRYOS_LINK } from "./request-data";

/**
 * Whether this deployment can take an embryo file (design §10, the
 * `COPILOT_GROUP_SCOPES_AVAILABLE` precedent). False until the ingest
 * session routes, the browser sanitiser and the worker (E0/E2) exist: the
 * flow renders its first two steps and then states the truth instead of
 * offering a control that goes nowhere. `src/lib/embryos/upload-flow.test.ts`
 * pins this to the reducer's terminal screen, so flipping it without
 * building the remaining steps fails the unit suite.
 */
export const EMBRYO_INGEST_AVAILABLE = false;

/** The h1 and the document title (design §4). */
export const UPLOAD_H1 = "Add embryo files";

/** Brief line 1083: every step states "Step N of M". */
export const STEP_TOTAL = 5;

export function stepStatus(step: number): string {
  return `Step ${step} of ${STEP_TOTAL}`;
}

/** What is still to come, stated on every rendered step (brief line 1083). */
export const STILL_TO_COME_STATUS: Readonly<Record<number, string>> = {
  1: "Still to come: whose embryos these are, who signs, what you agree to, and the file.",
  2: "Still to come: who signs, what you agree to, and the file.",
};

// ---------------------------------------------------------------------------
// The honest state of this deployment (design §10).
// ---------------------------------------------------------------------------

/** Design §10, verbatim. */
export const INGEST_UNAVAILABLE_SENTENCE = "Inherit cannot take embryo files on this site yet.";

/** Above step 1, so nobody answers questions for a control that does not exist. */
export const INGEST_UNAVAILABLE_LEDE =
  "You can answer the first questions now and get the letter for your clinic or lab. The later steps open when files can be added.";

/** On the closing screen: what the later steps will ask for, true on every basis and for either class of uploader. */
export const INGEST_NEXT_STEPS =
  "When files can be added, the next steps ask who must sign or what must be shown. After that come two things to agree to, and then the file.";

// ---------------------------------------------------------------------------
// Step 1 — the three questions (brief lines 374-377, verbatim).
// ---------------------------------------------------------------------------

export const TESTED_QUESTION_HEADING = "Did your clinic do genetic testing on your embryos?";

export type TestedAnswer = "yes" | "no" | "unsure";

export const TESTED_OPTIONS: readonly { id: TestedAnswer; label: string }[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "I’m not sure" },
];

/** Character-for-character (brief line 375): `No` ends the flow. */
export const NO_TESTING_END =
  "Inherit needs data from a genetic test the laboratory already ran. Without it there is nothing to read.";

export const WHO_QUESTION_HEADING = "Who did the testing?";

/** Design §2.2: the answer is never persisted, and the screen says so. */
export const WHO_NOT_KEPT_NOTE = "Inherit does not keep this name.";

export const SENT_QUESTION_HEADING = "What did they send you?";

export type SentAnswer = "per-embryo-file" | "one-file-columns" | "pdf-only" | "zip-folder";

/** The four illustrated options (brief line 377), verbatim. */
export const SENT_OPTIONS: readonly { id: SentAnswer; label: string }[] = [
  { id: "per-embryo-file", label: "A spreadsheet or text file per embryo" },
  { id: "one-file-columns", label: "One file with a column per embryo" },
  { id: "pdf-only", label: "A PDF report only" },
  { id: "zip-folder", label: "A zip folder" },
];

/** The fifth option, a secondary link beneath the four (brief line 377), verbatim. */
export const SENT_UNKNOWN_LINK = "I don’t know — let me upload it and you tell me";

/** "A PDF report only" ends in the refusal (design §2.2): the A.6 sentence from its one home. */
export const PDF_REFUSAL = INGEST_REFUSALS.pdf_not_data;

// ---------------------------------------------------------------------------
// Step 2 — whose embryos (brief lines 980-991; §5 §2.8 lines 1729-1735).
// ---------------------------------------------------------------------------

export const SITUATION_QUESTION_HEADING = "Whose embryos are these?";

export type UploadSituation = "own-embryos" | "with-genetic-parents-permission";

/** Options 3 and 4 of brief lines 980-991 with their exact attestation checkboxes. */
export const SITUATION_OPTIONS: readonly { id: UploadSituation; label: string; attestation: string }[] = [
  {
    id: "own-embryos",
    label: "My embryos",
    attestation: "These are my own embryos and I am a genetic parent.",
  },
  {
    id: "with-genetic-parents-permission",
    label: "Embryos, with both genetic parents’ permission",
    attestation:
      "Both genetic parents have given me permission to upload these embryos to Inherit. I can show that permission if asked.",
  },
];

/**
 * The checkbox routes the flow; the draft that keeps a record is a later
 * step (design §2.2 step 2; brief line 1726: nothing leaves quarantine until
 * every required party has signed). True today and on every basis.
 */
export const NOTHING_KEPT_YET_NOTE = "Nothing is kept yet. A record is made in a step still to come.";

export const BASIS_QUESTION_HEADING = "Who can sign for these embryos?";

export type Basis = "two-evidenced-parents" | "donor-gamete-anonymous" | "parent-deceased" | "sole-legal-disposition-authority";

/**
 * The four bases of `closed-embryo-cohort-draft-v1`, each with the sentence
 * its named screen states (brief lines 1731 and 1734 verbatim; the other
 * two say what the rule is in fewer words). Labels and sentences are in the
 * third person, because the same screens follow both situations: a genetic
 * parent, and someone uploading with both parents’ permission.
 */
export const BASIS_OPTIONS: readonly { id: Basis; label: string; sentence: string }[] = [
  {
    id: "two-evidenced-parents",
    label: "Both parents can sign for themselves",
    sentence: "Both parents will sign in their own accounts.",
  },
  {
    id: "donor-gamete-anonymous",
    label: "One parent was a donor who cannot be named",
    sentence:
      "A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.",
  },
  {
    id: "parent-deceased",
    label: "One parent has died",
    sentence: "Inherit will ask for the death certificate. A named person reviews it; no computer approves it.",
  },
  {
    id: "sole-legal-disposition-authority",
    label: "One person alone has the legal right to decide for these embryos",
    sentence:
      "Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete.",
  },
];

// ---------------------------------------------------------------------------
// Controls.
// ---------------------------------------------------------------------------

export const CONTINUE_BUTTON = "Continue";
export const BACK_BUTTON = "Back";

/** The closing screen's one primary action and the way back, from their homes. */
export { BACK_TO_EMBRYOS_LINK, REQUEST_DATA_BUTTON };
