import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";

/**
 * The Copilot group scopes (register `copilot-route-scope-v1`,
 * `scope-derived-v1`, `copilot-transport-availability-v1`).
 *
 * Two different questions, kept apart:
 *
 *   1. Is a group scope BUILT here? That is `copilotGroupScopes()`. The
 *      Family scope is built and runs under the TEST-LOCAL acceptance row
 *      only (`INHERIT_TEST_JURISDICTION=1`): Family needs
 *      `third_party_adult_analysis` and `family_heritability`, and no real
 *      jurisdiction permits either today. The Embryo (cohort) scope is not
 *      built: it waits for embryo publication and stays refused with the
 *      register's `copilotCohortUnavailablePage`.
 *   2. Can THIS deployment run it? Every group scope is a true non-self
 *      scope, so it runs only on a server-attested same-host local model
 *      (`model-endpoint-v1`). That is decided per request by the page and
 *      the chat route, never by this flag. On Vercel it is always no, and
 *      `/copilot/family` renders the registered unavailable page.
 *
 * Overview's Family and Embryo Copilot boxes, and the two hub tiles, link to
 * a group scope only when (1) says it is built. Turning (1) on outside
 * TEST-LOCAL is an owner decision.
 */
export interface CopilotGroupScopes {
  family: boolean;
  cohort: boolean;
}

export function copilotGroupScopes(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CopilotGroupScopes {
  return { family: isTestJurisdictionEnabled(env), cohort: false };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export type CopilotRouteScope =
  | { kind: "self" }
  | { kind: "family" }
  | { kind: "subject"; id: string }
  | { kind: "cohort"; id: string }
  | { kind: "report"; id: string };

/**
 * `copilot-route-scope-v1.singleSegmentGrammar`: the fixed literals are tested
 * before the prefixed forms, each prefix maps to exactly one kind, and every
 * other value (a non-canonical UUID, an encoded separator, a dot segment) is
 * invalid. The segment is already decoded once by the router.
 */
export function parseCopilotRouteScope(segment: string): CopilotRouteScope | null {
  if (segment === "me") return { kind: "self" };
  if (segment === "family") return { kind: "family" };
  const match = new RegExp(`^([scr])-(${UUID})$`).exec(segment);
  if (!match) return null;
  const kind = match[1] === "s" ? "subject" : match[1] === "c" ? "cohort" : "report";
  return { kind, id: match[2] };
}

/** The route segment for a cohort's Copilot, in the register's grammar. */
export function cohortScopeSegment(cohortId: string): string {
  return `c-${cohortId}`;
}
