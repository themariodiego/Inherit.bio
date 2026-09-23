import reviewedCorrections from "../../../data/report-scientific-corrections.json";
import { resolveVariant } from "./reports";

export { REPORT_SCIENTIFIC_CORRECTION_NOTICE } from "@/copy/reports/scientific-correction";

export interface ScientificCorrectionTemplate {
  readonly slug: string;
  readonly title?: string;
  readonly summary: string;
  readonly variants: readonly {
    readonly rsid: number;
    readonly interpretations: Readonly<Record<string, string>>;
  }[];
}

export interface ScientificCorrectionOutcome {
  readonly rsid: number;
  readonly outcome: Readonly<{
    status: string;
    genotype?: string;
    interpretation?: string;
    strandFlipped?: boolean;
  }>;
}

export type ReportScientificCorrection = Readonly<{
  id: string;
  correctedOn: string;
  reviewPath: string;
}> & (
  | Readonly<{ field: "title" | "summary"; rsid?: never; genotype?: never }>
  | Readonly<{ field: "interpretation"; rsid: number; genotype: string }>
);

type Batch = typeof reviewedCorrections[number];
type Entry = Batch["fields"][number];
const rawDiploidCalls = ["A/A", "A/C", "A/G", "A/T", "C/C", "C/G", "C/T", "G/G", "G/T", "T/T"];

// The resolver stores canonical keys even for opposite-strand input. Derive
// possible saved pairs once; do not normalize an unproven old output into one.
const possibleOutcomes = new Map(reviewedCorrections.map((batch) => [batch.slug,
  batch.variants.flatMap((variant) => {
    const interpretations = Object.fromEntries(batch.fields.flatMap((entry) =>
      entry.field === "interpretation" && entry.rsid === variant.rsid && entry.genotype !== undefined
        ? [[entry.genotype, entry.oldText]] : []));
    return rawDiploidCalls.flatMap((raw) => {
      const outcome = resolveVariant({ ...variant, interpretations }, raw);
      return outcome.status === "genotyped" ? [{ rsid: variant.rsid, ...outcome }] : [];
    });
  }),
]));

function descriptor(batch: Batch, entry: Entry): ReportScientificCorrection | null {
  const shared = { id: entry.id, correctedOn: batch.correctedOn, reviewPath: batch.reviewPath };
  if (entry.field === "title" || entry.field === "summary") {
    return Object.freeze({ ...shared, field: entry.field });
  }
  if (entry.field === "interpretation" && entry.rsid !== undefined && entry.genotype !== undefined) {
    return Object.freeze({ ...shared, field: "interpretation", rsid: entry.rsid, genotype: entry.genotype });
  }
  return null;
}

/**
 * Exact pre-correction prose only, not a second claims registry or a judgment
 * that unregistered content is incorrect. Each batch retains its source Git
 * revisions and dated review. No input mutation or snapshot digest conversion.
 */
export function reportScientificCorrections(
  template: ScientificCorrectionTemplate,
): readonly ReportScientificCorrection[] {
  const matches: ReportScientificCorrection[] = [];
  for (const batch of reviewedCorrections) {
    if (batch.slug !== template.slug) continue;
    for (const entry of batch.fields) {
      const matched = entry.field === "title" || entry.field === "summary"
        ? entry.oldText === template[entry.field]
        : entry.field === "interpretation" && entry.rsid !== undefined && entry.genotype !== undefined &&
          template.variants.some((variant) => variant.rsid === entry.rsid &&
            Object.hasOwn(variant.interpretations, entry.genotype!) &&
            variant.interpretations[entry.genotype!] === entry.oldText);
      const correction = matched ? descriptor(batch, entry) : null;
      if (correction) matches.push(correction);
    }
  }
  return Object.freeze(matches);
}

/** A no-catalog result can match only a known, resolver-consistent old outcome. */
export function reportOutcomeScientificCorrections(
  slug: string,
  variants: readonly ScientificCorrectionOutcome[],
): readonly ReportScientificCorrection[] {
  const matches: ReportScientificCorrection[] = [];
  for (const batch of reviewedCorrections) {
    if (batch.slug !== slug) continue;
    for (const entry of batch.fields) {
      if (entry.field !== "interpretation") continue;
      const matched = variants.some(({ rsid, outcome }) => rsid === entry.rsid &&
        outcome.status === "genotyped" && outcome.genotype === entry.genotype &&
        outcome.interpretation === entry.oldText && typeof outcome.strandFlipped === "boolean" &&
        possibleOutcomes.get(slug)!.some((possible) => possible.rsid === rsid &&
          possible.genotype === outcome.genotype && possible.interpretation === outcome.interpretation &&
          possible.strandFlipped === outcome.strandFlipped));
      const correction = matched ? descriptor(batch, entry) : null;
      if (correction) matches.push(correction);
    }
  }
  return Object.freeze(matches);
}
