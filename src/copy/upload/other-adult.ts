/**
 * Another adult's DNA file, added by the person who invited them and held
 * until they answer (brief §2.6, G5.3). TEST-LOCAL only: the permission text
 * is a draft the owner has not approved, and this copy says so on the page.
 *
 * The signed statements, the summary and the false-statement warning are
 * never copied here: the page renders them from the artifact itself, so the
 * words beside each checkbox are the words that are signed.
 */
export const OTHER_ADULT_UPLOAD_COPY = {
  heading: "Someone you invited",
  detail:
    "You can add a DNA file for an adult you invited, if they gave you permission. Nobody can open it and nothing is analysed until they accept in their own account.",
  draftNote: "This permission text is for tests only. It is not yet in use.",
  invitedOn: (date: string) => `Invited on ${date}.`,
  signHeading: "Their DNA, with their permission",
  versionLine: (version: number, date: string) => `Version ${version}, effective ${date}`,
  statementsHeading: "Confirm each of these",
  typedNameLabel: "Type your full legal name to sign",
  typedNameError: "Type your first and family name, each two letters or more.",
  signButton: "Sign",
  signing: "Saving…",
  signFailed: "We could not save this. Reload the page to try again with the current details.",
  chooseHeading: "Add their file",
  chooseDetail:
    "Choose the raw DNA file they gave you. It goes straight to private storage, and nobody can open it until they answer.",
  chooseButton: "Choose their file",
  chooseLabel: "Choose their raw DNA file",
  progress: {
    checking: "Checking the file format…",
    hashing: (percent: number) => `Checking the file on this device… ${percent}%`,
    uploading: (percent: number) => `Uploading to private storage… ${percent}%`,
    validating: "Checking the whole stored file…",
  },
  heldStatus: (label: string) => `Waiting for ${label} to confirm. Nothing has been analysed.`,
  heldDeadline: (date: string) => `If they do not answer by ${date}, the file is deleted.`,
  reviewingStatus: "They have read the invitation. You cannot add a file now.",
  accountFirstStatus: "Add your date of birth in your own upload first.",
  unavailableStatus: "You cannot add a file for this person right now.",
  uploadFailed: "The file could not be added. Please try again.",
} as const;
