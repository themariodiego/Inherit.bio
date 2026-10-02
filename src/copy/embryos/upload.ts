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
 * `COPILOT_GROUP_SCOPES_AVAILABLE` precedent, now
 * `copilotGroupScopes()` in src/lib/copilot/group-scopes.ts). False until the ingest
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
  3: "Still to come: what you agree to, and the file.",
  4: "Still to come: the file.",
  5: "Still to come: checking the file.",
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

// ---------------------------------------------------------------------------
// Steps 2–5 where ingest is built (TEST-LOCAL only; `embryoIngestBuilt()` in
// src/lib/embryos/upload-stage.ts). `EMBRYO_INGEST_AVAILABLE` above stays
// false: it is the production statement, and production still says it.
// ---------------------------------------------------------------------------

/** Step 2's last screen: the record the draft route keeps. */
export const DRAFT_QUESTION_HEADING = "Make the record";

export const EMBRYO_COUNT_LABEL = "Number of embryos in the file";

/** One address per parent who is not you (the basis decides how many). */
export function parentEmailLabel(index: number, count: number): string {
  if (count === 1) return "Other parent’s email";
  return `Email for parent ${index + 1}`;
}

/** What the record is, stated before it is made. */
export const DRAFT_NOTE =
  "This record has no file. It ends after 30 days if the people who need to sign have not.";

export const SAVE_DRAFT_BUTTON = "Save and continue";

/** Step 3 — who signs. */
export const OWNER_SIGN_HEADING = "Sign your statements";

export const OWNER_SIGN_LEDE =
  "Read each one in full. Your typed name signs them. This does not start any analysis.";

export const INVITE_HEADING = "Invite the other parent";

export const INVITE_LEDE =
  "They sign in their own account. Type the address you gave when you made the record.";

export const SEND_INVITATION_BUTTON = "Send the invitation";

export const INVITATION_SENT_STATUS = "If that address is right, Inherit will send the invitation.";

export const WAITING_HEADING = "Waiting for the other parent";

export const WAITING_SENTENCE = "Waiting for the other parent to sign in their own account.";

/** The draft's fixed deadline in words (`embryo.cohort-draft-30d`). */
export function draftDeadlineNote(date: string): string {
  return `This record ends on ${date} if they have not finished their part.`;
}

/** The co-parent's own screen, after they accepted the invitation. */
export const CO_PARENT_SIGN_HEADING = "Sign to continue";

export const CO_PARENT_SIGN_LEDE =
  "You accepted the invitation. Before the files can be added, you also state your right to decide for these embryos.";

export const CO_PARENT_DONE_STATUS = "You have finished your part. The other parent will add the file.";

/** A basis that needs a reviewed document: that review does not exist yet. */
export const EVIDENCE_REVIEW_UNAVAILABLE =
  "This basis needs a document that a named person reviews. That review is not open on this site yet.";

/** Step 4 — what you agree to. */
export const ACKNOWLEDGE_HEADING = "What you agree to";

export const ACKNOWLEDGE_LEDE =
  "Read both in full. Your typed name signs both, and then the record is ready for the file.";

export const FINALIZE_BUTTON = "Agree and go to the file";

export const RECORD_KEY_CARDS_HEADING = "Record Key Cards";

export const RECORD_KEY_CARDS_NOTE =
  "Print or copy these now. They are shown only this one time. Keep them for the future person.";

/** A card's date, which stays provisional until every embryo's file is checked. */
export function cardDateNote(words: string, provisional: boolean): string {
  return provisional ? `Date: ${words}, for now. It can change after the file check.` : `Date: ${words}.`;
}

/** Step 5 — the file. */
export const FILE_QUESTION_HEADING = "Choose the file";

export const FILE_NOTE =
  "Your browser will check the file first. It does not send the name of any embryo.";

export const FILE_RULES_BODY = "Anything outside chromosomes 1 to 22 stays on this device.";

export const FILE_INPUT_LABEL = "File";

export const SEND_FILE_BUTTON = "Send the file";

export const FILE_READING_STATUS = "Reading the file in this browser…";

export function fileSendingStatus(part: number): string {
  return `Part ${part}: upload started…`;
}

export const FILE_FINISHING_STATUS = "File sent. Upload not complete yet…";

/** The processing panel: stage names only, no count and no embryo (design §2.2 A.10). */
export const PROCESSING_HEADING = "Checking the file";

export const PROCESSING_SENTENCE =
  "Nothing about any embryo shows until every embryo in the file has been checked.";

/** Design §2.2 A.10, verbatim. */
export const UPLOAD_FAILED_SENTENCE =
  "The upload did not finish. No genetic data was kept, and every Record Key Card from this upload is now invalid.";

/** A finalized record whose upload was left before the file was sent. */
export const UPLOAD_LEFT_SENTENCE =
  "This upload was left before the file was sent. It ends on its own within a day, and nothing about the embryos was kept.";

/** The file step's refusals and the ones this page adds. */
export const FILE_REFUSED_STATUS = "Inherit could not take this file.";

export const OPEN_EMBRYOS_BUTTON = "Go to your embryos";

/** The draft route refused the addresses: each must be another person's, given once. */
export const DRAFT_CONTACTS_STATUS =
  "Check each email. Use each only one time. It needs to be for someone else.";

/** A file whose embryo count is not the record's. Nothing was sent. */
export const FILE_COUNT_MISMATCH_STATUS =
  "The number of embryos in this file does not match the record. Nothing was sent. Choose the right file.";

/** What was wrong with the file, when the browser found it before anything was sent. */
export const FILE_NOT_SENT_NOTE = "Nothing was sent. You can choose another file.";

/** The co-parent's way from the accepted invitation to the one statement left. */
export const SIGN_LAST_STATEMENT_LINK = "Sign to continue";

export const STAGE_READ_FAILED_STATUS = "Inherit could not read this upload. Load the page again to try again.";

export const UPLOAD_STOPPED_SENTENCE = "The upload stopped. No results are shown. Inherit will clear this attempt.";

export const FILE_FORMAT_BODY = "For now, choose one VCF file with at least two embryos. Other file types cannot be added here yet.";

export const ANALYSIS_PERMISSION_HEADING = "Agree to see results";
export const ANALYSIS_PERMISSION_BUTTON = "Agree";
export const ANALYSIS_PERMISSION_LEDE = "Adding the file did not allow analysis. Each parent decides this in their own account. Results show only when everyone agrees.";

export const SIGN_IN_AGAIN_BUTTON = "Sign in again";
export const SIGN_IN_AGAIN_STATUS = "Sign in again to continue. Your account may need to be checked before you can go on.";
