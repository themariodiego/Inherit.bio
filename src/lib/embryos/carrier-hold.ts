import "server-only";
import { z } from "zod";
import { getSensitiveAccountContext } from "../account-deletion";
import { createAdminClient } from "../supabase/admin";
import { isTestJurisdictionEnabled } from "../legal/jurisdictions";
import { allowedConditionsRegistry, type AllowedConditionsFile } from "./allowed-conditions";
import { EmbryoReadError } from "./cohorts";

const held = z.object({ status: z.literal("held"), reason: z.literal("scientific_disclosures_pending") }).strict();
type Rpc = (name: "current_embryo_carrier_hold_v1", args: { p_account: string; p_session: string;
  p_cohort: string; p_test: true }) => { abortSignal(signal: AbortSignal):
    PromiseLike<{ data: unknown; error: unknown }> };

/** Called by the real saved detail/comparison pages only after their existing
 * jurisdiction, cohort, current grant and Tier-2 gates. It derives the live
 * account/session again; the database resolves the entire current saved job,
 * source and reference set. The only admitted public value is a hold state. */
export async function loadSavedEmbryoCarrierHold(accountId: string, cohortId: string,
  options: { rpc?: Rpc; registry?: AllowedConditionsFile } = {}): Promise<z.infer<typeof held> | null> {
  if (!isTestJurisdictionEnabled()
    || (options.registry ?? allowedConditionsRegistry()).conditions.length === 0) return null;
  if (!z.uuid().safeParse(accountId).success || !z.uuid().safeParse(cohortId).success)
    throw new EmbryoReadError("embryo_carrier_hold", "invalid selection");
  const account = await getSensitiveAccountContext();
  if (!account || account.user.id !== accountId) return null;
  try {
    const admin = options.rpc ? null : createAdminClient();
    const rpc = options.rpc ?? admin!.rpc.bind(admin) as unknown as Rpc;
    const result = await rpc("current_embryo_carrier_hold_v1", { p_account: account.user.id,
      p_session: account.sessionId, p_cohort: cohortId, p_test: true }).abortSignal(AbortSignal.timeout(30_000));
    if (!isTestJurisdictionEnabled() || result.error !== null) throw new Error("unavailable");
    if (result.data === null) return null;
    const parsed = held.safeParse(result.data);
    if (!parsed.success) throw new Error("invalid response");
    return parsed.data;
  } catch {
    throw new EmbryoReadError("embryo_carrier_hold", "saved read unavailable");
  }
}
