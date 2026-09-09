export const OWN_UPLOAD_COPY = {
  accountHeading: "Complete your account",
  accountDetail: "Inherit is for adults. Add your birth date once before uploading your DNA. This is an age declaration, not an identity check.",
  birthDateLabel: "Date of birth",
  accountContinue: "Save and continue",
  adultRequired: "Enter a valid birth date. You must be 18 or older.",
  insuranceHeading: "Read this before you upload",
  insuranceCheckbox: "I have read this disclosure and I understand it.",
  insuranceContinue: "Continue",
  ownHeading: "Your own DNA",
  ownCheckbox: "I am 18 or older and this is my own DNA.",
  saved: "Your permission is saved.",
  saving: "Saving…",
  failed: "We could not save this. Reload the page to try again with the current details.",
  unavailable: "We cannot prepare this upload right now. Your existing files and results have not changed.",
  uploadsPaused: "New uploads are temporarily paused. Please try again later. Your existing files and reports are still available.",
  underage: "Inherit is for adults aged 18 or older.",
  /**
   * The size sentences. Each names the measurement that actually refused the
   * file, because they call for different actions: a file over the per-file
   * ceiling, an account with no room left, and a small compressed file whose
   * unpacked contents are too big are three different problems, and only the
   * first is fixed by choosing a smaller file. Every number is the
   * deployment's live ceiling read at request time, never a compiled-in
   * figure, and none of these sentences promises a future limit.
   */
  limitStatement: (arrayMegabytes: number, vcfMegabytes: number) =>
    (arrayMegabytes === vcfMegabytes
      ? `We can take files up to ${arrayMegabytes} MB.`
      : `We can take genotype table files up to ${arrayMegabytes} MB, and VCF or gVCF files up to ${vcfMegabytes} MB.`)
    + " A compressed file is measured after it is unpacked, so the unpacked size has to fit as well.",
  tooLarge: (megabytes: number) => `This file is bigger than the ${megabytes} MB we can take for this kind of file.`,
  tooLargeUnknownLimit: "This file is bigger than we can take right now. Your saved files have not changed.",
  accountFull: (megabytes: number) =>
    `This file does not fit in the ${megabytes} MB your account can still hold. Delete a file you no longer need, then try again.`,
  accountFullUnknownLimit: "Your account has no room left for this file. Delete a file you no longer need, then try again.",
  decompressedTooLarge:
    "This file unpacks to more than we can take. Compressed files are measured after they are unpacked, not by their stored size. Your saved files have not changed.",
} as const;
