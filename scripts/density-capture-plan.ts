import { z } from "zod";
import { requiredDensityCaptures, type DensityRegister } from "./density-current";

export const DENSITY_VIEWPORTS = [
  { id: "390x844", width: 390, height: 844 },
  { id: "1280x800", width: 1280, height: 800 },
] as const;
export const densitySourceSchema = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/),
  registerSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const localOrigin = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    && url.origin === value;
}, "Exact disposable local app origin required");
export const densityRuntimeSchema = z.object({
  version: z.literal(1), scope: z.literal("disposable-synthetic-native"),
  source: densitySourceSchema, appOrigin: localOrigin, buildId: z.string().min(1).max(256),
  ownerNonce: z.string().uuid(), bootId: z.string().uuid(),
  systemIdentifier: z.string().regex(/^[1-9][0-9]{0,19}$/), databaseOid: z.number().int().positive(),
  databaseName: z.literal("postgres"), daemonSha256: digest, fixtureSourceSha256: digest,
}).strict();
export const densityStateProofSchema = z.object({
  version: z.literal(1), routeId: z.string().min(1), state: z.string().min(1),
  source: densitySourceSchema, runtimeSha256: digest,
  // These are complete native authority/current-state observations. The
  // browser driver does not manufacture them from labels or screenshots.
  authorizationSha256: digest, currentDataSha256: digest, sessionSha256: digest,
  navigationSha256: digest, fixtureSourceSha256: digest,
}).strict();
export type DensitySource = z.infer<typeof densitySourceSchema>;
export type DensityRuntime = z.infer<typeof densityRuntimeSchema>;
export type DensityStateProof = z.infer<typeof densityStateProofSchema>;
export type DensityPage = DensityRegister["routes"][number] & { auth?: string };
export interface DensityStateCase { route: DensityPage; state: string }
export interface DensityCaptureHold { routeId: string; state: string | null;
  reason: "no-registered-measurable-state" | "native-state-fixture-missing" }

export const densityStateKey = (routeId: string, state: string) => JSON.stringify([routeId, state]);

/** Derives today's complete page census. There is no 22/62/63 route list. */
export function densityCapturePlan(register: DensityRegister, fixtureKeys: readonly string[]) {
  const pages = register.routes.filter(route => route.kind === "page") as DensityPage[];
  if (!pages.length || new Set(pages.map(route => route.id)).size !== pages.length)
    throw new Error("Distinct current page census required");
  if (new Set(fixtureKeys).size !== fixtureKeys.length) throw new Error("Duplicate density fixture");
  const holds: DensityCaptureHold[] = [];
  const measurable: DensityPage[] = [];
  for (const route of pages) {
    if (!["hub", "standard", "reading", "flow", "wide-data", "marketing"].includes(route.surface))
      throw new Error("Known density surface required for every page");
    const profile = register.stateProfiles[route.stateProfile ?? ""];
    if (!profile?.supported.length || new Set(profile.supported).size !== profile.supported.length)
      throw new Error(`Registered state profile required: ${route.id}`);
    const waivers = route.notApplicableStates ?? {};
    if (Object.keys(waivers).some(state => !profile.supported.includes(state))
      || Object.values(waivers).some(reason => !reason.trim())) throw new Error("Invalid existing state waiver");
    if (profile.supported.every(state => Object.hasOwn(waivers, state)))
      holds.push({ routeId: route.id, state: null, reason: "no-registered-measurable-state" });
    else measurable.push(route);
  }
  const required = measurable.length ? requiredDensityCaptures({ ...register, routes: measurable }) : [];
  const states = required.filter(row => row.viewport === DENSITY_VIEWPORTS[0].id)
    .map(row => ({ route: row.route as DensityPage, state: row.state }));
  const expected = new Set(states.map(row => densityStateKey(row.route.id, row.state)));
  for (const key of fixtureKeys) if (!expected.has(key)) throw new Error("Unknown density fixture");
  const available = new Set(fixtureKeys);
  for (const row of states) if (!available.has(densityStateKey(row.route.id, row.state)))
    holds.push({ routeId: row.route.id, state: row.state, reason: "native-state-fixture-missing" });
  return { pages, states, requiredCaptureCount: required.length, holds,
    status: holds.length ? "HOLD_CURRENT_DENSITY_FIXTURES" as const : "READY_FOR_ACTUAL_CAPTURE" as const };
}

/** Checks the concrete live URL without persisting bearer parameters/query. */
export function densityRouteMatches(pattern: string, navigation: string, origin: string) {
  const url = new URL(navigation, origin);
  if (url.origin !== origin || url.hash || url.username || url.password || url.pathname.includes("%")
    || url.pathname.includes("\\") || url.pathname.includes("//")) return false;
  const expected = pattern.split("/"), actual = url.pathname.split("/");
  return expected.length === actual.length && expected.every((part, index) =>
    /^\[[a-zA-Z][a-zA-Z0-9]*\]$/.test(part)
      ? /^[a-zA-Z0-9._-]+$/.test(actual[index]) && ![".", ".."].includes(actual[index])
      : part === actual[index]);
}

export function checkedDensityStateProof(input: unknown, expected: {
  row: DensityStateCase; source: DensitySource; runtimeSha256: string;
  navigationSha256: string; fixtureSourceSha256: string;
}) {
  const value = densityStateProofSchema.parse(input);
  if (value.routeId !== expected.row.route.id || value.state !== expected.row.state
    || JSON.stringify(value.source) !== JSON.stringify(densitySourceSchema.parse(expected.source))
    || value.runtimeSha256 !== expected.runtimeSha256 || value.navigationSha256 !== expected.navigationSha256
    || value.fixtureSourceSha256 !== expected.fixtureSourceSha256) throw new Error("Current native density state proof required");
  return value;
}
