import "server-only";
import { z } from "zod";
import { getSensitiveAccountContext } from "../account-deletion";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { createAdminClient } from "../supabase/admin";
import { allowedConditionsRegistry, type AllowedConditionsFile } from "./allowed-conditions";
import { carrierLibraryCoverageSchema } from "./carrier-library-coverage";
import { EmbryoReadError, type EmbryoCohortView } from "./cohorts";
import { acknowledged } from "./tier2";

const qualityReason = z.enum(["embryo_call_rate", "embryo_parent_discordant", "contamination",
  "dropout_too_high", "qc_review_required"]);
const rowSchema = z.object({ embryoId: z.uuid(), conditionId: z.string(),
  coverage: carrierLibraryCoverageSchema.nullable(), qualityReason: qualityReason.nullable() }).strict()
  .refine(row => row.coverage !== null ? row.qualityReason === null && row.conditionId === row.coverage.conditionId
    : row.qualityReason !== null);
export type CarrierLibraryCoverageRow = z.infer<typeof rowSchema>;
const readSchema = z.object({ version: z.literal("embryo-carrier-library-read-v1"), cohortId: z.uuid(),
  publicationRevision: z.number().int().positive().safe(), rows: z.array(rowSchema).min(1).max(64 * 20_000) }).strict();
type Rpc = (name: "current_embryo_carrier_library_coverage_v1", args: {
  p_account: string; p_session: string; p_cohort: string; p_test: true;
}) => { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };

/** Coverage may leave the server only after the same live account, current
 * whole cohort/analysis and session-scoped Tier-2 gate as a comparison. The
 * service-only RPC independently checks the full current native publication;
 * its response must contain exactly every embryo × registered carrier entry.
 * Empty registry, stale publication and absent gates remain honest absence. */
export async function loadSavedCarrierLibraryCoverage(accountId: string, cohort: EmbryoCohortView,
  options: { rpc?: Rpc; registry?: AllowedConditionsFile } = {}): Promise<CarrierLibraryCoverageRow[] | null> {
  const registry = options.registry ?? allowedConditionsRegistry();
  const conditions = registry.conditions.filter(entry => entry.category === "Having children"
    && entry.permitted_result_kinds.length === 1 && entry.permitted_result_kinds[0] === "carrier_status"
    && entry.risk_model_id === null);
  if (!isTestJurisdictionEnabled() || conditions.length === 0 || cohort.status !== "active"
    || !cohort.analysisGranted) return null;
  const embryoIds = cohort.embryos.map(embryo => embryo.id);
  if (!z.uuid().safeParse(accountId).success || !z.uuid().safeParse(cohort.id).success
    || !z.array(z.uuid()).min(1).max(64).safeParse(embryoIds).success
    || embryoIds.length !== cohort.embryoCount
    || new Set(embryoIds).size !== embryoIds.length
    || new Set(conditions.map(entry => entry.condition_id)).size !== conditions.length)
    throw new EmbryoReadError("embryo_carrier_library", "invalid selection");
  const account = await getSensitiveAccountContext();
  if (!account || account.user.id !== accountId || !await acknowledged(account.user)) return null;
  try {
    const admin = options.rpc ? null : createAdminClient();
    const rpc = options.rpc ?? admin!.rpc.bind(admin) as unknown as Rpc;
    const result = await rpc("current_embryo_carrier_library_coverage_v1", { p_account: account.user.id,
      p_session: account.sessionId, p_cohort: cohort.id, p_test: true }).abortSignal(AbortSignal.timeout(30_000));
    if (!isTestJurisdictionEnabled() || result.error !== null) throw new Error("unavailable");
    if (result.data === null) return null;
    const parsed = readSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.cohortId !== cohort.id) throw new Error("invalid response");
    const expected = new Set(embryoIds.flatMap(id => conditions.map(entry => `${id}:${entry.condition_id}`)));
    const names = new Map(conditions.map(entry => [entry.condition_id, entry.condition_name]));
    const rows = parsed.data.rows;
    if (rows.length !== expected.size || new Set(rows.map(row => `${row.embryoId}:${row.conditionId}`)).size !== expected.size
      || rows.some(row => !expected.has(`${row.embryoId}:${row.conditionId}`)
        || (row.coverage !== null && row.coverage.conditionName !== names.get(row.conditionId))))
      throw new Error("invalid complete response");
    return rows;
  } catch {
    // Raw response/error values never enter logs or the public error state.
    throw new EmbryoReadError("embryo_carrier_library", "saved coverage unavailable");
  }
}
