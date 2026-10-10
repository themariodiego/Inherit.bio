// The rights page an upload-time notice's withdrawal link opens
// (register rights.withdraw, root rightsEmbryoWithdrawal). One home for its
// strings; `src/components/embryo/embryo-withdrawal-form.tsx` renders them.

export const EMBRYO_WITHDRAWAL_COPY = {
  eyebrow: "Your rights",
  title: "Embryo data with your name",
  intro:
    "This is what the person who added these records can see. Nothing here needs an account.",
  cohortLabel: (dateWords: string) => `Embryos added on ${dateWords}`,
  countLine: (count: number) => (count === 1 ? "1 embryo record" : `${count} embryo records`),
  statusHeading: "Each record",
  purposesHeading: "What this data may be used for",
  noPurposes: "Nothing yet. No analysis has been turned on.",
  findingsLine: "No result has been worked out from these records.",
  retentionLine: (days: number) => `Inherit deletes them at most ${days} days after they were added, unless they are renewed.`,
  actionsHeading: "What you can do",
  effect:
    "Either choice ends every use of these records at once and deletes every result built from them. It cannot be undone.",
  actions: {
    refuse: { label: "Refuse this upload", help: "You do not agree to this upload." },
    delete: { label: "Delete this data", help: "You want to delete this data." },
  },
  failed: "That did not go through. Nothing was changed. Reload this page to try again.",
  receipts: {
    refuse: {
      title: "You did not agree",
      body: "Every use of these records has ended and every result built from them was deleted. Every parent named on these records is told.",
    },
    delete: {
      title: "Data deleted",
      body: "Every use of these records has ended and every result built from them was deleted. Every parent named on these records is told.",
    },
  },
} as const;

/** The purposes a cohort can carry, in plain words. Any other is not shown. */
export const EMBRYO_WITHDRAWAL_PURPOSES: Readonly<Record<string, string>> = {
  "embryo.analysis": "Working out estimates about these embryos",
  "export.share-link": "Sharing a copy through a link",
  "raw.export": "Downloading the genetic data",
};
