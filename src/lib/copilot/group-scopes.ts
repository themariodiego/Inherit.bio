/**
 * The Copilot group scopes (register `copilot-route-scope-v1`,
 * `scope-derived-v1`, `copilot-transport-availability-v1`).
 *
 * Three different questions, kept apart:
 *
 *   1. Is a group scope BUILT? That is `copilotGroupScopes()`, and it is the
 *      same on every deployment. The Family scope is built: the owner turned
 *      it on everywhere on 2026-09-28 (PR #260), so Overview's Family Copilot
 *      box and the Family hub's Copilot tile open `/copilot/family` wherever
 *      Inherit runs, exactly as the register's box contract names it. The
 *      Embryo (cohort) scope is not built: it waits for embryo publication
 *      and stays refused with the register's `copilotCohortUnavailablePage`.
 *   2. Can THIS deployment run it? Every group scope is a true non-self
 *      scope, so it runs only on a server-attested same-host local model
 *      (`model-endpoint-v1`). That is decided per request by the page and
 *      the chat route, never by this flag, and it is decided first. On
 *      Vercel it is always no: `/copilot/family` renders the registered
 *      unavailable page and reads nothing.
 *   3. May THIS account read anyone? The jurisdiction gate
 *      (`third_party_adult_analysis` and `family_heritability`, for both
 *      accounts) and every adult's own directional grants. No real
 *      jurisdiction permits either capability today, so nobody's data is
 *      read outside the TEST-LOCAL acceptance row, whatever (1) says.
 */
export interface CopilotGroupScopes {
  family: boolean;
  cohort: boolean;
}

export function copilotGroupScopes(): CopilotGroupScopes {
  return { family: true, cohort: false };
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
