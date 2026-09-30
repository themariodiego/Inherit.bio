import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { assertEmbryoDto, type EmbryoFinding, type QcDto, type RscEmbryoDetail } from "@/lib/embryos/policy";
import { projectFuturePersonFinding } from "./future-person-report-projection";

const unavailable = (): never => { throw new Error("export unavailable"); };
const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/u), revision = z.number().int().positive().safe();
const timestamp = z.iso.datetime({ offset: true });
export const historicalClaimantScore = z.object({ id: uuid, condition_id: z.string(), condition_name: z.string(), finding: z.unknown(),
  evidence_label: z.enum(["clinical", "established", "emerging", "preliminary"]), coverage_state: z.enum(["covered", "partial", "not_covered", "quality_not_measurable"]),
  citation_ids: z.array(z.string()), not_covered_reason: z.string().nullable(), model_id: z.string().nullable(), model_version: z.string().nullable(),
  source_binding_fingerprint: hash, computation_revision: revision, computed_at: timestamp }).strict();
export const historicalClaimantFigure = z.object({ id: uuid, finding_id: uuid,
  figure_kind: z.enum(["absolute_risk", "interval", "natural_frequency", "within_family"]), payload: z.unknown(),
  figure_revision: revision, created_at: timestamp, findingRecord: historicalClaimantScore }).strict();
export const historicalClaimantReport = z.object({ id: uuid, report_kind: z.string().regex(/^[a-z][a-z0-9._-]{0,100}$/u),
  report_revision: revision, source_binding_fingerprint: hash, artifact: z.unknown(), created_at: timestamp, embryoId: uuid }).strict();

/** JSON from the private member door, without executable/accessor properties.
 * Refuse the entire candidate before a policy walker can invoke an accessor. */
function plain(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 16) return unavailable();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || seen.has(value)) return unavailable();
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 10000
      || Reflect.ownKeys(value).length !== value.length + 1) return unavailable();
    for (let index = 0; index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      if (!field || !field.enumerable || !("value" in field)) return unavailable(); plain(field.value, seen, depth + 1);
    }
  } else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return unavailable();
    for (const key of Reflect.ownKeys(value)) {
      const field = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !field.enumerable || !("value" in field)) return unavailable(); plain(field.value, seen, depth + 1);
    }
  }
  seen.delete(value);
}
function finding(value: z.infer<typeof historicalClaimantScore>): EmbryoFinding {
  return assertEmbryoDto("EmbryoFinding", { embryo_label: "Your claimed record", condition_id: value.condition_id,
    condition_name: value.condition_name, finding: value.finding, evidence_label: value.evidence_label,
    coverage_state: value.coverage_state, citation_ids: value.citation_ids, not_covered_reason: value.not_covered_reason } as EmbryoFinding);
}
export function projectHistoricalClaimantFigure(value: unknown) {
  plain(value); const row = historicalClaimantFigure.parse(value), bound = finding(row.findingRecord);
  if (row.finding_id !== row.findingRecord.id || bound.finding?.kind !== "absolute_risk") return unavailable();
  const source = bound.finding, own = projectFuturePersonFinding(bound), projected = own.finding;
  if (!projected || projected.kind !== "absolute_risk") return unavailable();
  let expected: unknown, component: unknown, withheldComponents: string[] = [];
  switch (row.figure_kind) {
    case "absolute_risk": expected = source; component = projected; withheldComponents = own.withheldComponents; break;
    case "interval": expected = { interval_low: source.interval_low, interval_high: source.interval_high };
      component = { intervalLow: projected.intervalLow, intervalHigh: projected.intervalHigh }; break;
    case "natural_frequency": expected = source.natural_frequency; component = projected.naturalFrequency;
      withheldComponents = ["natural_frequency.comparator_numerator"]; break;
    case "within_family": expected = source.within_family; component = projected.publishedWithinFamilyValidation; break;
  }
  // Payload identity is genuine stored evidence, not a value reconstructed and
  // represented as the historical figure. Every stored payload must match.
  if (!isDeepStrictEqual(row.payload, expected)) return unavailable();
  return { id: row.id, findingId: row.finding_id, figureKind: row.figure_kind, revision: row.figure_revision, recordedAt: row.created_at,
    findingRevision: row.findingRecord.computation_revision, sourceBindingFingerprint: row.findingRecord.source_binding_fingerprint,
    modelId: row.findingRecord.model_id, modelVersion: row.findingRecord.model_version, component: structuredClone(component),
    withheldComponents, ...(withheldComponents.length ? { withholdingReason: "outside-claimed-subject" as const } : {}) };
}
export function projectHistoricalClaimantQc(value: unknown) {
  plain(value); const source = assertEmbryoDto("qc", value as QcDto);
  const { parent_a_concordance: _a, parent_b_concordance: _b, ...own } = source; void _a; void _b;
  return { ...structuredClone(own), parentConcordanceDisposition: "outside-claimed-subject" as const };
}
export function projectHistoricalClaimantReport(value: unknown) {
  plain(value); const row = historicalClaimantReport.parse(value);
  if (!row.artifact || typeof row.artifact !== "object" || Array.isArray(row.artifact)) return unavailable();
  const artifact = row.artifact as Record<string, unknown>;
  let component: unknown, shape: string, withheldComponents: string[];
  if (Object.hasOwn(artifact, "condition_id")) {
    component = projectFuturePersonFinding(assertEmbryoDto("EmbryoFinding", artifact as unknown as EmbryoFinding));
    shape = "EmbryoFinding"; withheldComponents = ["embryo_label"];
  } else if (Object.hasOwn(artifact, "findings")) {
    const detail = assertEmbryoDto("rscEmbryoDetail", artifact as unknown as RscEmbryoDetail);
    if (detail.id !== row.embryoId || detail.findings.some(item => item.embryo_label !== detail.display_label)) return unavailable();
    component = { status: detail.status, quality: detail.qc === null ? null : projectHistoricalClaimantQc(detail.qc),
      findings: detail.findings.map(projectFuturePersonFinding) };
    shape = "rscEmbryoDetail"; withheldComponents = ["cohort_id", "sample_ordinal", "display_label", "id"];
  } else if (Object.hasOwn(artifact, "sites_expected")) {
    component = projectHistoricalClaimantQc(artifact); shape = "qc"; withheldComponents = ["parent_a_concordance", "parent_b_concordance"];
  } else return unavailable();
  return { id: row.id, recordedKind: row.report_kind, revision: row.report_revision, sourceBindingFingerprint: row.source_binding_fingerprint,
    recordedAt: row.created_at, recordedShape: shape, component, withheldComponents, withholdingReason: "outside-claimed-subject" as const };
}
