/**
 * Another adult's DNA file under the register's Path B, "I have their file"
 * (brief §5.2 Path B, G5.3; owner decision of 2026-09-28). TEST-LOCAL only,
 * and the page says so.
 *
 * Signed statements, summaries and the false-statement warning are never
 * copied here: the pages render them from the artifacts themselves, so the
 * words beside each checkbox are the words that are signed.
 */
export const OTHER_ADULT_UPLOAD_COPY = {
  heading: "Upload with their written permission",
  detail:
    "For an adult who cannot use Inherit themselves. They sign first, by email, with no account. Each file you add then waits for them to say yes, and nothing is made from it before that.",
  testNote: "This is for tests only. It is not yet in use.",
  newHeading: "Ask someone new",
  nameLabel: "Their full name",
  emailLabel: "Their email address",
  // Neither label nor button may share words with the own upload's "Date of
  // birth" and "Continue" on the same page: a label is matched by its words.
  birthLabel: "When they were born",
  birthError: "This person is under 18.",
  detailsButton: "Save their details",
  detailsFailed: "We could not save these details. Check them and try again.",
  requestedOn: (date: string) => `Asked on ${date}.`,
  signHeading: "Your permission to add their file",
  versionLine: (version: number, date: string) => `Version ${version}, effective ${date}`,
  statementsHeading: "Confirm each of these",
  typedNameLabel: "Type your full legal name to sign",
  typedNameError: "Type your first and family name, each two letters or more.",
  requestEmailLabel: "Their email address again",
  signAndSendButton: "Sign and send the request",
  sendButton: "Send the request",
  signButton: "Sign",
  saving: "Saving…",
  sendFailed: "We could not send the request. Reload the page to try again.",
  signFailed: "We could not save this. Reload the page to try again with the current details.",
  awaitingSignature: (label: string, date: string) => `Waiting for ${label} to sign. The request ends on ${date}.`,
  chooseHeading: "Add their file",
  chooseDetail:
    "Choose the raw DNA file they gave you. It goes straight to private storage. They get an email, and nothing is made from it until they say yes.",
  chooseButton: "Choose their file",
  chooseLabel: "Choose their raw DNA file",
  progress: {
    checking: "Checking the file format…",
    hashing: (percent: number) => `Checking the file on this device… ${percent}%`,
    uploading: (percent: number) => `Uploading to private storage… ${percent}%`,
    validating: "Checking the whole stored file…",
  },
  pendingStatus: (label: string) => `Waiting for ${label} to confirm the file. Nothing has been made from it.`,
  pendingDeadline: (date: string) => `If they do not confirm it by ${date}, it is deleted.`,
  confirmedStatus: (label: string, date: string) =>
    `${label} accepted the file added on ${date}.`,
  refusedStatus: (label: string, date: string) => `${label} declined the file added on ${date}. It will be deleted.`,
  endedStatus: (date: string) => `The file added on ${date} was deleted.`,
  accountFirstStatus: "Add your date of birth in your own upload first.",
  unavailableStatus: "You cannot add a file for this person right now.",
  uploadFailed: "The file could not be added. Please try again.",
} as const;

/**
 * The reviewed-document branch of Path B (owner decision 2026-10-16, "The
 * subjects endpoints (G2.1)"), TEST-LOCAL only: the uploader sends a
 * permission document the person signed, a named person at Inherit reviews
 * it, and only then is the person asked to confirm. Nothing here says the
 * document is approved until a reviewer has decided.
 */
export const REVIEWED_DOCUMENT_COPY = {
  flowLegend: "How they give permission",
  flowEsignature: "They sign online. We email them a link.",
  flowDocument: "They signed a permission document. I will send it.",
  documentHeading: "Send their written permission",
  documentDetail:
    "Send the permission document they signed, as a PDF, JPEG or PNG of at most 20 MB. A person at Inherit reads it. Nothing is sent to them until it is approved.",
  documentLabel: "Choose their written permission",
  documentButton: "Send the file",
  documentStatus: {
    working: "Saving the file…",
    scanning: "Checking the file for a virus…",
    received: "We have the file.",
    oversize: "Choose a file under 20 MB.",
    type: "This file is not a PDF, JPEG or PNG.",
    limited: "You cannot send another file for this person now.",
    expired: "This page has expired. Open the page again.",
    integrity: "The file changed as it was sent. Try again.",
    malware: "This file did not pass the virus check.",
    unscannable: "This file could not be checked for a virus. Try another copy.",
    failed: "The file could not be sent. Try again.",
  },
  reviewStatus: (label: string) =>
    `A person at Inherit is reading the document for ${label}. Nothing has been sent to them yet.`,
  refusedStatus: (label: string) =>
    `The document for ${label} was not approved. Nothing was sent to them, and their details are deleted.`,
  requestDetail: (label: string) =>
    `The document was approved. Send ${label} the request to confirm. Nothing is added until they confirm it.`,
  requestButton: "Send the request",
  requestFailed: "We could not send the request. Reload the page to try again.",
  requestEnds: (date: string) => `This request ends on ${date}.`,
} as const;

/**
 * The person's side on `/withdraw/session`: the request to sign, then one
 * screen per file added for them.
 */
export const PATH_B_REQUEST_COPY = {
  heading: "A request to add your DNA file",
  detail: (label: string) =>
    `They wrote your name as ${label}. Nothing has been added yet, and they cannot see anything about you.`,
  // The text is approved; the request itself is not open anywhere yet.
  testNote: "This request is for tests only. It is not yet in use.",
  statementsHeading: "Confirm each of these",
  // Path B's account branch: signed in with the address the request went to.
  accountNote: (country: string) =>
    `You are signed in, so this is kept with your Inherit account. The country on your account, ${country}, is the one that counts.`,
  typedNameLabel: "Type your full legal name to sign",
  typedNameError: "Type your first and family name, each two letters or more.",
  // adult.unconfirmed-30d and adult.non-account-holder-24mo (730 days), shown
  // only to a person signing with no account: a person who signs with their
  // own account has no 730-day clock (the register's cancelWhen).
  keep: (days: number) =>
    `Each file they add is deleted after 30 days unless you say yes to it. If you say yes, we keep that file for at most ${days} days from that day. Then we delete it.`,
  // The existing registered contact of last resort (the same as the notice's).
  contact: "If the link does not work, or you did not expect this, write to privacy@inherit.bio.",
  signButton: "Sign",
  saving: "Saving…",
  refuseButton: "Refuse",
  deleteButton: "Delete this request",
  failed: "We could not record your choice. This page may have expired. Open the link in the email again.",
  receipts: {
    confirm: {
      title: "Request accepted",
      body: "They can now add a DNA file for you. We email you each time, and nothing is made from a file until you say yes to it.",
    },
    confirmAccount: {
      title: "Request accepted",
      body: "They can now add a DNA file for you. We email you each time, and you can also see each file on your Files page. Nothing is made from a file until you say yes to it.",
    },
    refuse: {
      title: "Request declined",
      body: "Nothing was added. This address will not get this request again.",
    },
    delete: {
      title: "Request deleted",
      body: "Nothing was added, and the request is gone.",
    },
  },
} as const;

export const ADULT_UPLOAD_REVISION_COPY = {
  heading: "A DNA file was added for you",
  added: (date: string, kind: "array" | "vcf") =>
    `It was added on ${date}. It is ${kind === "array" ? "a raw data file" : "a VCF file"}.`,
  uploader: (name: string | null) => name
    ? `Who added it: ${name}. This is the name on their account.`
    : "Who added it: Someone with an Inherit account.",
  contact: "If the link does not work, or you did not expect this, write to privacy@inherit.bio.",
  seeHeading: "What they can see",
  see: (label: string) =>
    `The name they wrote for you (${label}), the day the file was added, and whether you said yes. They see no result.`,
  nothingYet: "Nothing is made from this file until you say yes.",
  deadline: (date: string) => `If you do nothing, it is deleted on ${date}.`,
  // adult.non-account-holder-24mo: a file confirmed with no account of your
  // own is kept for exactly 730 days from the yes. Each line is shown only
  // when the database reports that clock for this file.
  keepIfYes: (days: number) => `If you say yes, we keep it for at most ${days} days from that day. Then we delete it.`,
  keptUntil: (days: number, date: string) =>
    `We keep it for at most ${days} days from the day you said yes. It is deleted on ${date}.`,
  // The upload-time notice's fixed payload does not say whether the person
  // signed with an account, so it states the condition the clock depends on.
  noticeKeep: (days: number) =>
    `If you signed our request without an Inherit account and you say yes, we keep the file for at most ${days} days from that day. Then we delete it.`,
  confirmedOn: (date: string) => `You said yes to this file on ${date}.`,
  confirmButton: "Yes, this is my file",
  refuseButton: "No, delete this file",
  deleteButton: "Delete everything about me",
  deleteDetail: "This deletes every file they added for you, and your signature. They do not need to agree.",
  saving: "Saving…",
  failed: "We could not record your choice. This page may have expired. Open the link in the email again.",
  receipts: {
    confirm: {
      title: "File accepted",
      body: "Nothing is made from it yet. Inherit asks you first, one purpose at a time, before anything is shared.",
    },
    refuse: {
      title: "File declined",
      body: "It is being deleted. Your signature and any other file stay as they are.",
    },
    delete: {
      title: "Everything deleted",
      body: "Every file they added for you, and your signature, are being deleted.",
    },
  },
} as const;

/**
 * Path B's account branch on `/files`: the files someone added for the
 * signed-in person, read-only. Answers still come from the link in each
 * file's email.
 */
export const HELD_FOR_YOU_COPY = {
  heading: "Files added for you",
  name: (label: string) => `They wrote your name as ${label}.`,
  pending: (added: string, kind: "array" | "vcf", deleteBy: string) =>
    `${kind === "array" ? "A raw data file" : "A VCF file"} added on ${added} is waiting for your answer. Use the link in our email to say yes or no. If you do nothing, it is deleted on ${deleteBy}.`,
  confirmed: (added: string, kind: "array" | "vcf") =>
    `You said yes to the ${kind === "array" ? "raw data file" : "VCF file"} added on ${added}.`,
} as const;

/**
 * Path B's reading layer on `/files` (TEST-LOCAL only): the person's choices,
 * one kind of result at a time, for themselves and for the person who added
 * the file; and the uploader's one line about what was shared with them.
 * Nothing is made either way yet, and both sides are told so.
 */
export const PATH_B_CHOICES_COPY = {
  heading: "What can be made from your file",
  detail: "Each kind of result is its own choice, for you and for the person who added your file. Results appear here when they are ready. This is for tests only.",
  layers: {
    "reports.monogenic": "Observed genetic variants",
    "reports.polygenic": "Trait reports and estimates",
    ancestry: "Ancestry",
  },
  forYou: "For you",
  forThem: "For the person who added your file",
  on: "On",
  off: "Off",
  affirmSelf: "I want Inherit to make these results for me.",
  affirmShare: "I let the person who added my file see this kind of result about my DNA.",
  turnOn: "Turn on",
  turnOff: "Turn off",
  saving: "Saving…",
  shareClosed: "Sharing with the person who added your file is not open yet.",
  details: (version: number) => `Permission details · version ${version}`,
  failed: "We could not confirm your choice. Refresh the page to check its current state before trying again.",
  uploaderShared: (label: string, layers: string) => `${label} shared: ${layers}.`,
  readyShared: (label: string) => `${label} has shared reports ready to read.`,
  readResults: (layer: string) => `Read your ${layer.toLowerCase()}`,
  openShared: "Read shared reports",
} as const;

/**
 * The closed list of what can ever be made from one file added under Path B:
 * the register's `closed-list-of-what-will-be-derived`
 * (upload-time-rights-notice-v1.adult.content) and the review projection's
 * `prospectiveDerivedCategoryLabels` (`closed-server-allowlist-only`). The
 * upload-time email and the review page on `/withdraw/session` both render
 * this one list, beside "nothing is made until you say yes", so the two
 * cannot drift. It names only what the code can produce from that file:
 *
 *   - `standard-copy`: the normalization a confirmed revision queues by
 *     itself, with no purpose grant, and only when the record is bound to
 *     the person's own account (path_b_normalization_authority_v1). It writes
 *     the file's private canonical rows; no reader policy admits them.
 *   - `reports.monogenic`, `reports.polygenic`: the two queued report
 *     outputs, each only after the person's own current grant for that
 *     purpose (enqueue_path_b_reports_v1), named as on the person's choices.
 *
 * Ancestry is not listed: a Path B ancestry choice can be recorded, but no
 * job makes an ancestry result from this file. Family pages read the
 * person's own record, never this file, and Copilot never reads it: the
 * file's descriptor closes the legacy chat scope (hasCanonicalCopilotScope).
 */
export const ADULT_UPLOAD_DERIVED_LIST = {
  heading: "What can be made from this file",
  items: [
    { category: "standard-copy",
      text: "A private copy of its DNA readings, put in a standard form. This can be made once you say yes." },
    { category: "reports.monogenic",
      text: `${PATH_B_CHOICES_COPY.layers["reports.monogenic"]}, only if you turn this on later.` },
    { category: "reports.polygenic",
      text: `${PATH_B_CHOICES_COPY.layers["reports.polygenic"]}, only if you turn this on later.` },
  ],
  closing: "Each of these needs your own Inherit account. You turn on each kind of result by itself. The person who added it sees a result only if you share it with them. Nothing else is made from this file.",
} as const;
