/**
 * The genetic-ingest refusals — brief A.6 lines 2196-2209, every code and
 * its sentence defined once (docs/canonical-artifacts.md: "Genetic-ingest
 * rejection IDs and user-facing messages"). The file processor, the embryo
 * ingest routes, the per-embryo quality reasons, the uploader's preflight
 * and the ingest-error tests all consume this file; nothing else spells
 * these sentences.
 *
 * Each sentence is written to the 240-character cap rather than the cap
 * being raised; none names an allele, a genotype or a variant identifier;
 * the apostrophe is U+2019 and the dash U+2014 (brief line 511). The
 * `{n}` of `too_large` is supplied by the caller from the one authority for
 * its flow (`src/lib/limits.ts` for a subject file, the payload boundary
 * contract mirrored in `src/lib/genome/ingest-limits.ts` for an embryo
 * ingest); no second limit lives here.
 *
 * The three per-embryo reasons are also rendered on the comparison's
 * quality footer around the measured figure (`src/copy/embryos/qc.ts`),
 * which spreads the halves defined here so the sentence has one home.
 */

export const INGEST_REFUSAL_CODES = [
  "unrecognised_format",
  "pdf_not_data",
  "too_large",
  "empty_after_parse",
  "build_unknown",
  "liftover_loss",
  "cohort_single_sample",
  "embryo_call_rate",
  "embryo_parent_discordant",
  "contamination",
] as const;
export type IngestRefusalCode = (typeof INGEST_REFUSAL_CODES)[number];

/** The refusal codes that are also per-embryo quality reasons (register `qcProjection.qcReasonIds`). */
export const EMBRYO_QC_REFUSAL_CODES = ["embryo_call_rate", "embryo_parent_discordant", "contamination"] as const;
export type EmbryoQcRefusalCode = (typeof EMBRYO_QC_REFUSAL_CODES)[number];

/**
 * The per-embryo sentences split around the one measured number each may
 * carry (only the call rate names one); the label of the embryo leads the
 * sentence in both the flat refusal and the quality footer.
 */
export const EMBRYO_REASON_PARTS: Record<EmbryoQcRefusalCode, { before: string; after: string }> = {
  embryo_call_rate: {
    before: "we could read only",
    after: "of the markers we need. We have not produced results, because results this sparse would mislead you.",
  },
  embryo_parent_discordant: {
    before: "",
    after:
      "this embryo’s genotypes do not match the genetic parents closely enough for us to be sure the files belong together. We have not produced results.",
  },
  contamination: {
    before: "",
    after: "this sample shows signs of mixed DNA, which makes per-embryo results unreliable. We have not produced results.",
  },
};

/** The A.6 table, character-for-character; the slots are the brief's own. */
export const INGEST_REFUSALS = {
  unrecognised_format:
    "We could not recognise this file. Inherit reads genotype files from home testing services, VCF and gVCF files, and genotype tables from a testing laboratory.",
  pdf_not_data:
    "This is a PDF, not genetic data. The numbers in it are conclusions, not the genotypes we need. Ask your clinic or lab for the raw data file — a VCF, or a CSV of genotypes per embryo. We have a letter you can send them.",
  too_large: (megabytes: number) => `This file is bigger than the ${megabytes} MB limit for this kind of file.`,
  empty_after_parse:
    "We read this file but found no genotypes in it. It may be a summary rather than the data itself.",
  build_unknown:
    "We could not tell which reference version this file uses, so we have not read it. Your laboratory can tell you.",
  liftover_loss:
    "More than 5 in 100 positions in this file did not match the reference we use, so we have not read it.",
  cohort_single_sample:
    "This file holds one sample, not several embryos. Upload it as a single genome, or ask your lab for the file with all of them.",
  embryo_call_rate: (label: string, pct: number) =>
    `${label}: ${EMBRYO_REASON_PARTS.embryo_call_rate.before} ${pct} in 100 ${EMBRYO_REASON_PARTS.embryo_call_rate.after}`,
  embryo_parent_discordant: (label: string) => `${label}: ${EMBRYO_REASON_PARTS.embryo_parent_discordant.after}`,
  contamination: (label: string) => `${label}: ${EMBRYO_REASON_PARTS.contamination.after}`,
} as const satisfies Record<IngestRefusalCode, string | ((...args: never[]) => string)>;

/** Every code's slots, so a caller can render any refusal from one call. */
export type IngestRefusalSlots = {
  /** The embryo's display label ("Embryo 3"), for the per-embryo reasons. */
  label?: string;
  /** Positions read, in 100, for `embryo_call_rate`. */
  pct?: number;
  /** The applicable limit in MB, for `too_large`. */
  megabytes?: number;
};

/** The rendered sentence for a code; a missing slot renders as the empty string, never a guess. */
export function ingestRefusal(code: IngestRefusalCode, slots: IngestRefusalSlots = {}): string {
  switch (code) {
    case "too_large":
      return INGEST_REFUSALS.too_large(slots.megabytes ?? 0);
    case "embryo_call_rate":
      return INGEST_REFUSALS.embryo_call_rate(slots.label ?? "", slots.pct ?? 0);
    case "embryo_parent_discordant":
      return INGEST_REFUSALS.embryo_parent_discordant(slots.label ?? "");
    case "contamination":
      return INGEST_REFUSALS.contamination(slots.label ?? "");
    default:
      return INGEST_REFUSALS[code];
  }
}

/** The register's `error` value for a status a route returns; true only for a registered code. */
export function isIngestRefusalCode(value: unknown): value is IngestRefusalCode {
  return typeof value === "string" && (INGEST_REFUSAL_CODES as readonly string[]).includes(value);
}
