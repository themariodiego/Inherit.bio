import type { RequiredSurface } from "./corpus";

type Row = Record<string, unknown>;
export interface CapturePolicy { requiresClaimWrapping: boolean; requiredClaimRegions: string[] }
export interface ClaimCapture {
  required: RequiredSurface;
  source: { kind: "route"; id: string; path: string; state: string; auth: string } |
    { kind: "email"; path: string } | { kind: "export"; contract: string };
}
export interface CapturePlanInput {
  /** The existing canonical route register, not the set of successful captures. */
  routeRegister: unknown;
  /** Discover actual entrypoint files; exclude composition-only files explicitly. */
  emailEntrypoints: readonly string[];
  /** Explicit code-owned policy; a missing/new surface must throw, never default false. */
  policyFor(source: ClaimCapture["source"]): CapturePolicy;
}

const row = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function fail(code: string): never { throw new Error(`claim-capture-plan:${code}`); }

/**
 * Derive mandatory page/state, email and export captures before any renderer runs.
 * This is the minimum route-level inventory, not proof of rendering or a substitute
 * for dynamic report/genotype, legal-version and multi-subject fixture expansion.
 * Route/state labels are stable capture keys, not navigable application URLs.
 */
export function planClaimCaptures(input: CapturePlanInput): ClaimCapture[] {
  if (!row(input.routeRegister)) fail("invalid-register");
  const register = input.routeRegister;
  if (!Array.isArray(register.routes) || !row(register.stateProfiles) || !Array.isArray(register.stateIds) ||
      !row(register.exportContracts)) fail("invalid-register");
  const stateIds = register.stateIds as unknown[];
  if (!stateIds.length || stateIds.some((s) => !nonempty(s)) || new Set(stateIds).size !== stateIds.length) fail("invalid-state-ids");
  const captures: ClaimCapture[] = [];
  const seen = new Set<string>();
  const add = (surface: string, channel: RequiredSurface["channel"], source: ClaimCapture["source"]) => {
    const key = `${channel}:${surface}`;
    if (seen.has(key)) fail("duplicate-capture");
    seen.add(key);
    const policy: unknown = input.policyFor(source);
    if (!row(policy) || typeof policy.requiresClaimWrapping !== "boolean" || !Array.isArray(policy.requiredClaimRegions) ||
        policy.requiredClaimRegions.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(id)) ||
        new Set(policy.requiredClaimRegions).size !== policy.requiredClaimRegions.length) fail("invalid-region-policy");
    captures.push({ required: { surface, channel, requiresClaimWrapping: policy.requiresClaimWrapping as boolean,
      requiredClaimRegions: [...policy.requiredClaimRegions] as string[] }, source });
  };
  const routeIds = new Set<string>();
  const routePaths = new Set<string>();
  let pageCount = 0;
  for (const route of register.routes as unknown[]) {
    if (!row(route) || !nonempty(route.kind)) fail("invalid-route");
    if (route.kind !== "page") continue;
    pageCount++;
    if (!nonempty(route.id) || !nonempty(route.path) || !route.path.startsWith("/") || !nonempty(route.auth) ||
        !nonempty(route.stateProfile) || !nonempty(route.disposition)) fail("invalid-page");
    const id = route.id as string, path = route.path as string, auth = route.auth as string;
    if (routeIds.has(id) || routePaths.has(path)) fail("duplicate-page");
    routeIds.add(id); routePaths.add(path);
    if (route.disposition !== "kept") fail("unexpected-page-disposition");
    const profile = (register.stateProfiles as Row)[route.stateProfile as string];
    if (!row(profile) || !Array.isArray(profile.supported) || !row(profile.notApplicable)) fail("invalid-state-profile");
    const supported = profile.supported as unknown[], notApplicable = profile.notApplicable as Row;
    if (!supported.length || new Set(supported).size !== supported.length || supported.some((s) => !stateIds.includes(s))) fail("invalid-supported-states");
    if (Object.keys(notApplicable).some((s) => !stateIds.includes(s) || supported.includes(s) || !nonempty(notApplicable[s]))) fail("invalid-state-exemption");
    for (const state of stateIds as string[]) if (!supported.includes(state) && !Object.hasOwn(notApplicable, state)) fail("undeclared-state");
    for (const state of supported as string[]) {
      // Build HTML covers only the ordinary static public complete state. Public
      // error/flow states are still rendered by the seeded browser harness.
      const channel = auth === "public" && route.stateProfile === "static-document" && state === "complete" && !path.includes("[")
        ? "static-build" : "seeded-authenticated";
      add(`${path}#state=${encodeURIComponent(state)}`, channel, { kind: "route", id, path, state, auth });
    }
  }
  if (!pageCount) fail("empty-page-inventory");
  if (!Array.isArray(input.emailEntrypoints) || !input.emailEntrypoints.length) fail("empty-email-inventory");
  for (const path of [...input.emailEntrypoints].sort()) {
    if (!/^src\/emails\/[a-z0-9-]+\.tsx$/.test(path) || path === "src/emails/base.tsx") fail("invalid-email-entrypoint");
    add(`email:${path}`, "email", { kind: "email", path });
  }
  const contracts = Object.keys(register.exportContracts as Row).sort();
  if (!contracts.length) fail("empty-export-inventory");
  for (const contract of contracts) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(contract) || !row((register.exportContracts as Row)[contract])) fail("invalid-export-contract");
    add(`export:${contract}`, "export", { kind: "export", contract });
  }
  return captures.sort((a, b) => a.required.surface < b.required.surface ? -1 : a.required.surface > b.required.surface ? 1 : 0);
}
