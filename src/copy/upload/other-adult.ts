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
  birthLabel: "Their date of birth",
  birthError: "This person is under 18.",
  detailsButton: "Continue",
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
    `${label} accepted the file added on ${date}. Nothing is made from it yet.`,
  refusedStatus: (label: string, date: string) => `${label} declined the file added on ${date}. It will be deleted.`,
  endedStatus: (date: string) => `The file added on ${date} was deleted.`,
  accountFirstStatus: "Add your date of birth in your own upload first.",
  unavailableStatus: "You cannot add a file for this person right now.",
  uploadFailed: "The file could not be added. Please try again.",
} as const;

/**
 * The person's side on `/withdraw/session`: the request to sign, then one
 * screen per file added for them.
 */
export const PATH_B_REQUEST_COPY = {
  heading: "A request to add your DNA file",
  detail: (label: string) =>
    `They wrote your name as ${label}. Nothing has been added yet, and they cannot see anything about you.`,
  testNote: "This permission text is for tests only. It is not yet in use.",
  statementsHeading: "Confirm each of these",
  typedNameLabel: "Type your full legal name to sign",
  typedNameError: "Type your first and family name, each two letters or more.",
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
  seeHeading: "What they can see",
  see: (label: string) =>
    `The name they wrote for you (${label}), the day the file was added, and whether you said yes. They see no result.`,
  nothingYet: "Nothing is made from this file until you say yes.",
  deadline: (date: string) => `If you do nothing, it is deleted on ${date}.`,
  confirmedOn: (date: string) => `You said yes to this file on ${date}. Nothing is made from it yet.`,
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
