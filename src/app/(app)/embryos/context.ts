import "server-only";

import { cache } from "react";
import { EMBRYO_ANALYSIS, embryoCapability } from "@/lib/embryos/access";
import { listCohortsForAccount } from "@/lib/embryos/cohorts";
import { createClient } from "@/lib/supabase/server";

/**
 * The reads every Embryo page starts with, cached per request so
 * `generateMetadata` and the page share them: the signed-in account and its
 * own jurisdiction decision for the route guard, then the cohort graph. The
 * viewer's decision is read before any cohort row, so a refused jurisdiction
 * fetches no private row at all.
 */
export const loadViewer = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const decision = await embryoCapability(user.id, [], EMBRYO_ANALYSIS);
  return { user, decision };
});

export const loadCohorts = cache((accountId: string) => listCohortsForAccount(accountId));
