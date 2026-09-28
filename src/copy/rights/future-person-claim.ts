/**
 * `/future-person/claim` (register rights.future-person-claim). Every
 * user-visible string of the page and its form lives here.
 *
 * The four keyed strings are the register's pre-form content
 * (`policy.preFormContent`): the page renders them, before the first form
 * control, in every state. They say what is refused and what cannot be
 * matched without saying whether any record or profile exists.
 */

export const CLAIM_EYEBROW = "Future Person Charter";
export const CLAIM_H1 = "Claim a record created before you were born";

export const FUTURE_PERSON_CLAIM_COPY = {
  "future-person.claim.refusal-standard-heading": "When we refuse a claim",
  "future-person.claim.refusal-standard-body":
    "We release a record only to the adult it was made from. A person on our team checks a photo ID and a birth record before we release anything. We refuse a claim if you are under 18, if your papers do not link you to the record, or if more than one record could be yours. We never guess between records, and we never say whether a record exists.",
  "future-person.claim.no-profile-condition":
    "A parent may have told us the date and place of birth and the parents’ names. If no parent did, a claim without the Record Key Card cannot be matched to a record.",
  "future-person.claim.no-profile-no-guess":
    "Without the Record Key Card we cannot tell which record is yours, and we will not guess.",
} as const;

/** Shown where the deployment can hold no embryo record at all. */
export const CLOSED_HEADING = "Claims are not open yet";
export const CLOSED_BODY =
  "No embryo records can be made on the hosted service without a legal review by a person. While records are blocked, we accept no claim papers or personal details.";

export const CONTACT_LINE =
  "Questions about a claim go to legal@inherit.bio. Do not send identity papers by email.";
export const KEEP_LINE =
  "If you stop after this step, we delete what you sent within 24 hours.";

export const FORM_HEADING = "Start a claim";
export const MODE_LEGEND = "What do you have?";
export const MODE_LABELS = {
  "record-key": "I have a Record Key",
  "claimant-recovery-key": "I have a Recovery Key",
  "keyless-start": "I have no key",
} as const;

export const RECORD_KEY_LABEL = "Record Key";
export const RECOVERY_KEY_LABEL = "Recovery Key";
export const KEY_HINT = "20 letters and numbers, as printed on the card or given at your earlier claim.";
export const NAME_LABEL = "Your full name";
export const DATE_OF_BIRTH_LABEL = "Your date of birth";
export const DATE_HINT = "Year, month and day, like 2000-01-31.";
export const EMAIL_LABEL = "Your email address";
export const EMAIL_HINT = "We write to you here, and only about this claim.";
export const BIRTH_PLACE_LABEL = "Where you were born";
export const PARENT_NAMES_LABEL = "The name of each parent";
export const PARENT_NAMES_HINT = "One to four names, one per line.";
export const AFFIRM_LABEL =
  "I am the person this record is about, I am at least 18, and what I have entered is true.";

export const SEND_BUTTON = "Start my claim";
export const SENDING_BUTTON = "Working…";

export const RECEIVED_HEADING = "We have your request";
export const RECEIVED_BODY =
  "Next you send a picture ID and a birth record, and a person on our team reviews them. Nothing you sent says whether a record exists.";

export const LIMITED_STATUS = "Too many claims were started. Please try again.";
export const EXPIRED_STATUS = "This page has expired. Open it again to start.";
export const INVALID_STATUS = "Please check your details.";
export const FAILED_STATUS = "Your claim could not be started. Please try again.";
export const FIELD_ERROR = "Please check this.";

/** The documents step, shown once this browser holds a live claim. */
export const DOCUMENTS_HEADING = "Send your files";
export const DOCUMENTS_INTRO =
  "Send a photo ID and a birth record. We check each file for viruses before anyone opens it. Then a person on our team reviews them.";
export const DOCUMENT_LABELS = {
  "future-photo-identity": "Picture ID",
  "future-birth-record": "Birth record",
} as const;
export const DOCUMENT_FILE_HINT = "A PDF, JPEG or PNG file, up to 20 MB.";
export const SEND_FILE_BUTTON = "Send this file";
export const DOCUMENT_STATUS = {
  working: "Working…",
  scanning: "We are checking this file.",
  received: "We have this file. A person will review it.",
  infected: "We found a virus in this file and deleted it.",
  unscannable: "We could not check this file and deleted it.",
  oversize: "This file is too much. Please send a small one.",
  type: "This file is not a PDF, JPEG or PNG.",
  integrity: "Part of this file is missing. Please try again.",
  storage: "Part of this file is missing. Please try again.",
  expired: "This claim has ended. We deleted what you sent.",
  limited: "You have sent all the files we take.",
  failed: "Your file could not be sent. Please try again.",
} as const;
