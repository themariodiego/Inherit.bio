import "server-only";
import { z } from "zod";
import { getSensitiveAccountContext } from "../account-deletion";
import { createAdminClient } from "../supabase/admin";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { EmbryoReadError } from "./cohorts";
import { QC_THRESHOLDS, QC_REASON_IDS, RESULT_NOT_REPORTABLE_REASON_IDS } from "./qc-policy";
import { statisticalFittedReadSchema, type StatisticalFittedRead } from "./statistical-fit-contract";

const failure = z.object({ schema_version: z.literal(2),
  figure_basis: z.object({ version: z.literal(1), basis: z.literal("observed") }).strict(),
  kind: z.literal("coverage_failure"), metric: z.literal("score_coverage"), measured_value: z.number().min(0).lt(QC_THRESHOLDS.scoreCoverageFloor),
  required_minimum: z.literal(QC_THRESHOLDS.scoreCoverageFloor), display_copy_id: z.literal("embryo.result.insufficient-coverage") }).strict();
const row = z.object({ embryoId: z.uuid(), sampleOrdinal: z.number().int().min(0).max(63),
  conditionId: z.literal("SYNTHETIC:9001"), conditionName: z.literal("Synthetic score coverage"),
  coverageState: z.enum(["not_covered", "quality_not_measurable"]), reason: z.enum(RESULT_NOT_REPORTABLE_REASON_IDS),
  matchedVariants: z.number().int().min(0).max(10).nullable(), requiredVariants: z.literal(10).nullable(),
  scoreCoverage: z.number().min(0).max(1).nullable(), finding: failure.nullable() }).strict().superRefine((value, ctx) => {
  const refuse = () => ctx.addIssue({ code: "custom", message: "Closed statistical coverage required" });
  if (value.matchedVariants === null) {
    if (value.requiredVariants !== null || value.scoreCoverage !== null || value.finding !== null
      || value.coverageState !== "quality_not_measurable" || value.reason === "insufficient_coverage"
      || !(QC_REASON_IDS as readonly string[]).includes(value.reason)) refuse();
  } else if (value.requiredVariants !== 10 || value.scoreCoverage !== value.matchedVariants / 10
    || value.coverageState !== "not_covered") refuse();
  else if (value.scoreCoverage! < QC_THRESHOLDS.scoreCoverageFloor) {
    if (value.finding?.measured_value !== value.scoreCoverage || value.reason !== "insufficient_coverage") refuse();
  } else if (value.finding !== null || value.reason !== "sex_combined_model_unavailable") refuse();
});
export const statisticalCoverageReadSchema = z.object({ version: z.literal(1),
  producer: z.literal("embryo-test-score-coverage-v1"), jurisdiction: z.literal("TEST-LOCAL"), cohortId: z.uuid(),
  publicationRevision: z.number().int().positive().safe(), jobId: z.uuid(), attempt: z.number().int().min(1).max(20),
  captureSha256: z.string().regex(/^[0-9a-f]{64}$/), interpretation: z.literal("held"), rows: z.array(row).min(1).max(64),
}).strict().refine(value => new Set(value.rows.map(row => row.embryoId)).size === value.rows.length
  && value.rows.every((row, index) => row.sampleOrdinal === index));
export type StatisticalCoverageOnlyRead = z.infer<typeof statisticalCoverageReadSchema>;
export type StatisticalCoverageRead = StatisticalCoverageOnlyRead | StatisticalFittedRead;
type Rpc = (name: "current_embryo_test_statistical_v1" | "current_embryo_test_statistical_fit_v1", args: { p_account: string; p_session: string; p_cohort: string; p_test: true }) => {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };

/** Separate fixed TEST DTO; never broaden the clinical condition registry or
 * read arbitrary score rows. Native admission/default absence and the entire
 * current signed cohort/session/Tier-2/receipt chain are checked by the RPC. */
export async function loadSavedEmbryoStatisticalCoverage(accountId: string, cohortId: string,
  expectedEmbryoIds: readonly string[], options: { rpc?: Rpc } = {}): Promise<StatisticalCoverageRead | null> {
  if (!isTestJurisdictionEnabled()) return null;
  if (!z.uuid().safeParse(accountId).success || !z.uuid().safeParse(cohortId).success
    || expectedEmbryoIds.length === 0 || new Set(expectedEmbryoIds).size !== expectedEmbryoIds.length
    || expectedEmbryoIds.some(id => !z.uuid().safeParse(id).success)) throw new EmbryoReadError("embryo_statistical_coverage", "invalid selection");
  const account = await getSensitiveAccountContext();if (!account || account.user.id !== accountId) return null;
  try {
    const admin = options.rpc ? null : createAdminClient();
    const rpc = options.rpc ?? admin!.rpc.bind(admin) as unknown as Rpc;
    const args = { p_account: account.user.id, p_session: account.sessionId, p_cohort: cohortId, p_test: true as const };
    const fitted = await rpc("current_embryo_test_statistical_fit_v1", args).abortSignal(AbortSignal.timeout(30_000));
    if (!isTestJurisdictionEnabled() || fitted.error !== null) throw new Error("unavailable");
    if (fitted.data !== null) {
      const parsed = statisticalFittedReadSchema.safeParse(fitted.data);
      if (!parsed.success || parsed.data.cohortId !== cohortId
        || JSON.stringify(parsed.data.rows.map(row => row.embryoId)) !== JSON.stringify(expectedEmbryoIds)) throw new Error("invalid response");
      return parsed.data;
    }
    // An absent fitted admission/result is the only fallback. A malformed or
    // stale fitted response cannot be relabelled as a coverage-only result.
    const result = await rpc("current_embryo_test_statistical_v1", args).abortSignal(AbortSignal.timeout(30_000));
    if (!isTestJurisdictionEnabled() || result.error !== null) throw new Error("unavailable");
    if (result.data === null) return null;
    const parsed = statisticalCoverageReadSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.cohortId !== cohortId
      || JSON.stringify(parsed.data.rows.map(row => row.embryoId)) !== JSON.stringify(expectedEmbryoIds)) throw new Error("invalid response");
    return parsed.data;
  } catch { throw new EmbryoReadError("embryo_statistical_coverage", "saved read unavailable"); }
}
