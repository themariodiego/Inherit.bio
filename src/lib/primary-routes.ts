/**
 * Primary route builders — the one runtime mirror of the user-facing routes
 * in docs/route-register.json#routes (docs/canonical-artifacts.md names this
 * file as that register's consumer). The register's binding rule
 * (contractDefaults.bindingValidation) is that every runtime link
 * destination consumes a route id and that registered path literals occur
 * only in the register itself: nav, breadcrumbs, Overview boxes, the
 * subject bar and report footers build their hrefs here, and no component
 * spells a product path. External URLs (PubMed, doi, dbSNP) are not routes.
 *
 * Each builder takes the route's named params — the `[param]` segments of
 * the register pattern, each encoded with encodeURIComponent — and an
 * optional `{ query, hash }`, so callers express `?subject=me`,
 * `?report=slug`, `?reveal=1`, `?layer=…` and `#evidence`, `#polygenic`,
 * `#{categoryId}` through the builder rather than by string concatenation.
 *
 * `src/lib/primary-routes.test.ts` asserts that `routePattern(id)` equals
 * the register's `path` for every id here, so a pattern that drifts from the
 * register fails the unit suite.
 */

/** Register-style patterns (`[param]` segments), keyed by the register's route id. */
const ROUTE_PATTERNS = {
  "app.overview": "/overview",
  "genome.subject": "/genome/[subject]",
  "genome.reports": "/genome/[subject]/reports",
  "genome.report": "/genome/[subject]/reports/[slug]",
  "genome.ancestry": "/genome/[subject]/ancestry",
  "genome.data": "/genome/[subject]/data",
  "genome.browser": "/genome/[subject]/data/browser",
  "family.index": "/family",
  "family.invite": "/family/invite",
  "family.person": "/family/[person]",
  "family.permissions": "/family/[person]/permissions",
  "family.health-picture": "/family/health-picture",
  "family.portrait": "/family/portrait/[pairId]",
  "embryos.index": "/embryos",
  "embryos.upload": "/embryos/upload",
  "embryos.request-data": "/embryos/request-data",
  "embryos.compare": "/embryos/compare",
  "embryos.detail": "/embryos/[embryoId]",
  "copilot.scope": "/copilot/[scope]",
  "files.index": "/files",
  "files.upload": "/files/upload",
  "settings.index": "/settings",
  "settings.data": "/settings/data",
  "settings.copilot": "/settings/copilot",
  "settings.people": "/settings/people",
  "settings.consents": "/settings/consents",
  "marketing.providers": "/providers",
  "science.index": "/science",
  "legal.future-person": "/legal/future-person",
  "legal.where-inherit-works": "/legal/where-inherit-works",
} as const;

export type RouteId = keyof typeof ROUTE_PATTERNS;

type Pattern<Id extends RouteId> = (typeof ROUTE_PATTERNS)[Id];

/** The `[name]` segments of a register pattern, as a union of their names. */
type ParamNames<P extends string> = P extends `${string}[${infer Name}]${infer Rest}`
  ? Name | ParamNames<Rest>
  : never;

/** The named params a route's builder requires, one string per `[segment]`. */
export type RouteParams<Id extends RouteId> = {
  readonly [Name in ParamNames<Pattern<Id>>]: string;
};

export interface RouteOptions {
  /**
   * Rendered as `?key=value&…` in insertion order, key and value each
   * passed through encodeURIComponent. An empty object renders nothing.
   */
  query?: Readonly<Record<string, string>>;
  /** Appended verbatim as `#hash`: the id of an element on the destination page. */
  hash?: string;
}

/** A builder's arguments: the params first when the pattern has any, then the options. */
export type RouteArgs<Id extends RouteId> = [ParamNames<Pattern<Id>>] extends [never]
  ? [options?: RouteOptions]
  : [params: RouteParams<Id>, options?: RouteOptions];

export type RouteBuilder<Id extends RouteId> = (...args: RouteArgs<Id>) => string;

/** Every route id this module builds, in register order. */
export const ROUTE_IDS = Object.keys(ROUTE_PATTERNS) as readonly RouteId[];

/** The register-style pattern for `id` (`/genome/[subject]/reports`), for comparison with the register. */
export function routePattern(id: RouteId): string {
  return ROUTE_PATTERNS[id];
}

const SEGMENT = /\[([^\]]+)\]/g;

function fill(pattern: string, params: Readonly<Record<string, string>>): string {
  return pattern.replace(SEGMENT, (_segment, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new Error(`primary-routes: "${pattern}" needs a non-empty "${name}" segment`);
    }
    return encodeURIComponent(value);
  });
}

function suffix(options: RouteOptions | undefined): string {
  let out = "";
  const pairs = options?.query ? Object.entries(options.query) : [];
  if (pairs.length > 0) {
    out += `?${pairs
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&")}`;
  }
  if (options?.hash) out += `#${options.hash}`;
  return out;
}

function makeBuilder<Id extends RouteId>(id: Id): RouteBuilder<Id> {
  const pattern: string = ROUTE_PATTERNS[id];
  const builder = pattern.includes("[")
    ? (params: Readonly<Record<string, string>>, options?: RouteOptions) =>
        fill(pattern, params) + suffix(options)
    : (options?: RouteOptions) => pattern + suffix(options);
  return builder as RouteBuilder<Id>;
}

/** The typed map from route id to path builder. */
export const PRIMARY_ROUTES: { readonly [Id in RouteId]: RouteBuilder<Id> } = Object.fromEntries(
  ROUTE_IDS.map((id) => [id, makeBuilder(id)]),
) as { [Id in RouteId]: RouteBuilder<Id> };

/**
 * Build the href of a registered route:
 * `route("genome.reports", { subject }, { hash: "cancer" })` →
 * `/genome/me/reports#cancer`; `route("files.upload", { query: { subject } })`
 * → `/files/upload?subject=me`.
 */
export function route<Id extends RouteId>(id: Id, ...args: RouteArgs<Id>): string {
  const builder = PRIMARY_ROUTES[id] as (...builderArgs: RouteArgs<Id>) => string;
  return builder(...args);
}
