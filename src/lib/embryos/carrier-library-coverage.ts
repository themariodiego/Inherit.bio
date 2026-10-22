import { z } from "zod";
import { parseCarrierAssertionRows } from "../family/carrier-assertions";
import type { CoverageSpec } from "../figures/spec";

/** A separate coverage disclosure, never a carrier finding or score coverage.
 * Its caller must first validate the complete current native capture and saved
 * measurement set. This pure projection grants no read or publication access. */
export const CARRIER_POSITION_REASONS = ["not_covered", "source_call_disputed", "invalid_calls"] as const;
const reason = z.enum(CARRIER_POSITION_REASONS);
const count = z.number().int().nonnegative().safe().max(20_000);
const measurementSchema = z.object({
  assertion_id: z.number().int().positive().safe(),
  observed_copies: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  reason: reason.nullable(),
}).strict().refine(row => (row.observed_copies === null) === (row.reason !== null));

export const carrierLibraryCoverageSchema = z.object({
  version: z.literal("embryo-carrier-library-coverage-v1"),
  basis: z.literal("distinct-grch38-reviewed-loci-v1"),
  conditionId: z.string().regex(/^(MONDO:\d{7}|SYNTHETIC:\d{1,7})$/),
  conditionName: z.string().min(1).max(80),
  referenceReleaseId: z.string().regex(/^(clinvar-\d{4}-\d{2}|synthetic-[a-z0-9-]+)$/),
  checkedPositions: count,
  requiredPositions: count.positive(),
  coverageState: z.enum(["covered", "partial", "not_covered"]),
  // Each unresolved position belongs to exactly one reason-set group. Counts
  // therefore sum to N - n even when two assertions at one locus disagree.
  unresolved: z.array(z.object({ reasons: z.array(reason).min(1).max(3), positions: count.positive() }).strict()).max(7),
  interpretationStatus: z.literal("held"),
  holdReason: z.literal("scientific_disclosures_pending"),
}).strict().superRefine((value, context) => {
  const expectedState = value.checkedPositions === 0 ? "not_covered"
    : value.checkedPositions === value.requiredPositions ? "covered" : "partial";
  const keys = value.unresolved.map(group => group.reasons.join(","));
  if (value.checkedPositions > value.requiredPositions || value.coverageState !== expectedState
    || value.unresolved.reduce((sum, group) => sum + group.positions, 0)
      !== value.requiredPositions - value.checkedPositions
    || new Set(keys).size !== keys.length
    || value.unresolved.some(group => group.reasons.some((entry, index) => index > 0
      && CARRIER_POSITION_REASONS.indexOf(entry) <= CARRIER_POSITION_REASONS.indexOf(group.reasons[index - 1])))) {
    context.addIssue({ code: "custom", message: "invalid complete position coverage" });
  }
});
export type CarrierLibraryCoverage = z.infer<typeof carrierLibraryCoverageSchema>;

export class CarrierLibraryCoverageError extends Error {
  constructor() { super("invalid complete carrier position coverage"); this.name = "CarrierLibraryCoverageError"; }
}
function refuse(): never { throw new CarrierLibraryCoverageError(); }

/** Revalidate and pass the exact current native counts into the figure
 * contract. No assertion count, QC fraction or risk is substituted here. */
export function carrierLibraryCoverageFigure(value: CarrierLibraryCoverage): CoverageSpec {
  const parsed = carrierLibraryCoverageSchema.safeParse(value);
  if (!parsed.success) refuse();
  return { kind: "coverage", class: "quality", basis: "observed",
    provenance: { kind: "computed", module: "embryos/carrier-library-coverage" },
    read: parsed.data.checkedPositions, needed: parsed.data.requiredPositions,
    wording: "reviewed-condition", condition: parsed.data.conditionName };
}

/** Count canonical reviewed loci, not assertions or alternate indel spellings.
 * A locus is checked only when every captured assertion at it has an exact,
 * undisputed own-file reading. A partially interpretable locus stays in the
 * unresolved set; no absent allele, parental call or clinical phase is filled.
 * QC refusals are deliberately not accepted as zero scientific coverage. */
export function deriveCarrierLibraryCoverage(input: {
  conditionId: string; conditionName: string; assertions: unknown; measurements: unknown;
}): CarrierLibraryCoverage {
  const assertions = parseCarrierAssertionRows(input.assertions);
  const measured = z.array(measurementSchema).min(1).max(20_000).safeParse(input.measurements);
  if (assertions === null || assertions.length === 0 || !measured.success
    || assertions.some(row => row.condition_id !== input.conditionId || row.condition_name !== input.conditionName
      || row.inheritance_mode !== "autosomal_recessive")
    || new Set(assertions.map(row => row.assertion_id)).size !== assertions.length
    || new Set(assertions.map(row => row.release_id)).size !== 1
    || measured.data.length !== assertions.length
    || new Set(measured.data.map(row => row.assertion_id)).size !== measured.data.length) refuse();
  const measurements = new Map(measured.data.map(row => [row.assertion_id, row]));
  const loci = new Map<string, Set<(typeof CARRIER_POSITION_REASONS)[number]>>();
  for (const assertion of assertions) {
    const row = measurements.get(assertion.assertion_id);
    if (!row) refuse();
    const key = `${assertion.chrom}:${assertion.pos}`;
    const reasons = loci.get(key) ?? new Set<(typeof CARRIER_POSITION_REASONS)[number]>();
    if (row.reason !== null) reasons.add(row.reason);
    loci.set(key, reasons);
  }
  const groups = new Map<string, { reasons: (typeof CARRIER_POSITION_REASONS)[number][]; positions: number }>();
  let checkedPositions = 0;
  for (const reasons of loci.values()) {
    if (reasons.size === 0) { checkedPositions += 1; continue; }
    const ordered = CARRIER_POSITION_REASONS.filter(entry => reasons.has(entry));
    const key = ordered.join(",");
    const group = groups.get(key) ?? { reasons: ordered, positions: 0 };
    group.positions += 1; groups.set(key, group);
  }
  const requiredPositions = loci.size;
  const result = carrierLibraryCoverageSchema.safeParse({
    version: "embryo-carrier-library-coverage-v1", basis: "distinct-grch38-reviewed-loci-v1",
    conditionId: input.conditionId, conditionName: input.conditionName, referenceReleaseId: assertions[0].release_id,
    checkedPositions, requiredPositions,
    coverageState: checkedPositions === 0 ? "not_covered" : checkedPositions === requiredPositions ? "covered" : "partial",
    unresolved: [...groups.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, group]) => group),
    interpretationStatus: "held", holdReason: "scientific_disclosures_pending",
  });
  if (!result.success) refuse();
  return result.data;
}
