import { z } from "zod";
import { resultBasis, type ResultBasis } from "../figures/result-basis";
import { carrierReference, exactGenotypes, parseCarrierAssertionRows,
  type CarrierAssertionRow } from "../family/carrier-assertions";
import { alleleShape, isLeftAligned } from "../family/allele-key";
import { allowedConditionsRegistry, validateRegistryEntry,
  type AllowedConditionsFile, type ConditionRegistryRow } from "./allowed-conditions";
import type { CarrierFinding } from "./policy";

/**
 * A private measurement, not an eligibility resolver or public finding.
 * The worker must obtain the exact current database authority before reading
 * these calls and recheck it before saving anything. No runtime caller or
 * publication door is admitted by this module. The committed empty registry
 * refuses before even inspecting source, reference or genomic inputs.
 */
export const embryoCarrierSourceSchema = z.object({
  cohort_id: z.uuid(), embryo_id: z.uuid(), subject_id: z.uuid(), file_id: z.uuid(),
  canonical_build: z.literal("GRCh38"),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source_binding_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  source_publication_revision: z.number().int().positive().safe(),
  upload_revision: z.number().int().positive().safe(),
  normalization_source_revision: z.number().int().positive().safe(),
  call_immutability_proof: z.literal("exact-staged-calls-v1"),
}).strict();
export type EmbryoCarrierSource = z.infer<typeof embryoCarrierSourceSchema>;

const callSchema = z.object({
  fileId: z.uuid(), chrom: z.number().int().min(1).max(22),
  pos: z.number().int().positive().safe(), ref: z.string().regex(/^[ACGT]+$/),
  alt: z.string().regex(/^[ACGT]+$/).nullable(),
  genotype: z.string().regex(/^(?:[ACGT]+\/[ACGT]+|--)$/),
  usable: z.boolean().optional(),
}).strict();
const callsSchema = z.array(callSchema).max(256);
const conditionRowsSchema = z.array(z.object({ condition_id: z.string(), condition_name: z.string(),
  category: z.string(), active: z.boolean() }).strict()).max(1000);

export interface EmbryoCarrierObservation {
  version: 1;
  producer: "embryo-reviewed-allele-observation-v1";
  figure_basis: ResultBasis<"observed">;
  source: EmbryoCarrierSource;
  assertion: CarrierAssertionRow;
  covered_positions: 1;
  required_positions: 1;
  observed_copies: 0 | 1 | 2;
  carrier_state: CarrierFinding["carrier_state"];
  confirmation_required: true;
}

type Refusal = "unregistered_condition" | "invalid_reference" | "unsupported_allele_set"
  | "unsupported_inheritance" | "invalid_source" | "invalid_calls" | "not_covered" | "source_call_disputed";
export type EmbryoCarrierObservationResult =
  | { ok: true; observation: EmbryoCarrierObservation }
  | { ok: false; reason: Refusal };

export interface EmbryoCarrierObservationInput {
  condition_id: string;
  condition_registry: readonly ConditionRegistryRow[];
  /** Complete rows selected by private.carrier_assertion_rule_v1 for this condition. */
  assertions: unknown;
  source: unknown;
  /** Only this embryo's canonical rows at the assertion's registered spellings. */
  calls: unknown;
}

/**
 * Count one reviewed autosomal-recessive allele in one embryo's own diploid
 * calls. Different disease alleles cannot be summed into the existing
 * three-state DTO: phasing and a reviewed multi-allele interpretation would
 * be needed. Unsupported evidence therefore refuses the entire measurement.
 * This is observed sequence evidence, not a disease probability or diagnosis.
 */
export function observeEmbryoCarrierAllele(input: EmbryoCarrierObservationInput,
  registry: AllowedConditionsFile = allowedConditionsRegistry()): EmbryoCarrierObservationResult {
  const entries = registry.conditions.filter((entry) => entry.condition_id === input.condition_id);
  if (entries.length !== 1) return { ok: false, reason: "unregistered_condition" };
  const entry = entries[0];
  const conditionRows = conditionRowsSchema.safeParse(input.condition_registry);
  if (entry.category !== "Having children" || entry.risk_model_id !== null
    || entry.permitted_result_kinds.length !== 1 || entry.permitted_result_kinds[0] !== "carrier_status"
    || !conditionRows.success
    || !validateRegistryEntry(entry, { conditionRegistry: conditionRows.data, riskModels: [] }, registry).ok) {
    return { ok: false, reason: "unregistered_condition" };
  }

  const assertions = parseCarrierAssertionRows(input.assertions);
  if (assertions === null || assertions.length === 0
    || assertions.some((row) => row.condition_id !== entry.condition_id || row.condition_name !== entry.condition_name
      || !isLeftAligned(row.ref, row.alt)
      || row.review_stars !== ({ "practice guideline": 4, "reviewed by expert panel": 3,
        "criteria provided, multiple submitters, no conflicts": 2 } as const)[row.review_status]
      || row.release_id.startsWith("synthetic-") !== row.condition_id.startsWith("SYNTHETIC:")
      || (row.penetrance_class === "unestablished") !== (row.penetrance_citation === null))) {
    return { ok: false, reason: "invalid_reference" };
  }
  // A duplicate assertion is also ambiguous evidence; do not choose the first.
  if (assertions.length !== 1) return { ok: false, reason: "unsupported_allele_set" };
  const assertion = assertions[0];
  if (assertion.inheritance_mode !== "autosomal_recessive") return { ok: false, reason: "unsupported_inheritance" };
  const spellings = [{ pos: assertion.pos, ref: assertion.ref, alt: assertion.alt },
    ...assertion.equivalents.map(([pos, ref, alt]) => ({ pos, ref, alt }))];
  if (spellings.some((spelling, index) => alleleShape(spelling.ref, spelling.alt) !== alleleShape(assertion.ref, assertion.alt)
    || spelling.ref.length !== assertion.ref.length || spelling.alt.length !== assertion.alt.length
    || (index > 0 && spelling.pos <= spellings[index - 1].pos))
    || (alleleShape(assertion.ref, assertion.alt) === "snv" && spellings.length !== 1)) {
    return { ok: false, reason: "invalid_reference" };
  }
  const source = embryoCarrierSourceSchema.safeParse(input.source);
  if (!source.success || source.data.normalization_source_revision !== source.data.upload_revision) {
    return { ok: false, reason: "invalid_source" };
  }
  const calls = callsSchema.safeParse(input.calls);
  if (!calls.success || calls.data.some((call) => call.fileId !== source.data.file_id
    || call.chrom !== assertion.chrom || !spellings.some((spelling) => spelling.pos === call.pos)
    || (call.genotype !== "--" && call.genotype.split("/").some((allele) => allele !== call.ref && allele !== call.alt)))) {
    return { ok: false, reason: "invalid_calls" };
  }

  const reference = carrierReference([assertion]);
  const readings: string[] = [];
  for (const call of calls.data) {
    if (call.alt === null) {
      // Canonical VCF reference calls retain REF and no ALT. They are not
      // array calls. Read only the two literal, observed reference copies
      // at an exact registered spelling; never fill in an absent position.
      const spelling = spellings.find((candidate) => candidate.pos === call.pos && candidate.ref === call.ref);
      if (spelling) readings.push(call.usable === false || call.genotype === "--" ? "--"
        : `${assertion.ref}/${assertion.ref}`);
    } else {
      const genotype = exactGenotypes(reference.refVariants, [call]).genotypes.get(assertion.assertion_id);
      if (genotype !== undefined) readings.push(genotype);
    }
  }
  if (readings.length === 0 || readings.includes("--")) return { ok: false, reason: "not_covered" };
  const doses = readings.map((genotype) => genotype.split("/").filter((allele) => allele === assertion.alt).length);
  if (new Set(doses).size !== 1) return { ok: false, reason: "source_call_disputed" };
  const observed_copies = doses[0] as 0 | 1 | 2;
  const carrier_state = (["not_detected", "carrier", "two_variants"] as const)[observed_copies];
  return { ok: true, observation: {
    version: 1, producer: "embryo-reviewed-allele-observation-v1", figure_basis: resultBasis("observed"),
    source: source.data, assertion, covered_positions: 1, required_positions: 1,
    observed_copies, carrier_state, confirmation_required: true,
  } };
}
