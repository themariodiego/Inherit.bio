import { z } from "zod";

/** Uses the existing measure.mjs/compute.mjs output; it does not measure pixels. */
const viewportSchema = z.enum(["390x844", "1280x800"]);
const count = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1);
const dimension = z.number().nonnegative().nullable();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/),
  tree: z.string().regex(/^[a-f0-9]{40}$/),
  registerSha256: sha256,
}).strict();
const environmentSchema = z.object({
  browserName: z.literal("chromium"), browserVersion: z.string().min(1),
  platform: z.string().min(1), fontManifestSha256: sha256,
  theme: z.literal("light"), devicePixelRatio: z.literal(1),
  locale: z.literal("en-US"), timezone: z.literal("UTC"),
}).strict();
const metricsSchema = z.object({
  screenshotSha256: sha256,
  screenshotWidthPx: count, screenshotHeightPx: count,
  includedPixelCount: count.positive(), excludedPixelCount: count,
  inkPixelCount: count, inkCoverageRatio: fraction, whiteSpaceRatio: fraction,
  interactiveElementCount: count, rawInteractiveElementCount: count,
  rawDecoratedElementCount: count, budgetedDecoratedElementCount: count,
  visibleTextCharacterCount: count,
  statusView: z.string().min(1),
  proseElementCount: count, maxProseMeasureCh: dimension, minProseMeasureCh: dimension,
  topLevelSectionCount: count, minimumAdjacentSectionGapPx: dimension,
  primaryContentLeftPaddingPx: z.number().nonnegative(),
  primaryClaimTextElementCount: count.nullable(), primaryClaimFigureCount: count.nullable(),
  horizontalScroll: z.literal(false), horizontalOverflowPx: z.literal(0),
}).passthrough();
const predecessorSchema = z.object({
  baselineCommit: z.literal("864736979c92a08ba77e8580d61946eba6864918"),
  baselineRoute: z.string().startsWith("/"), state: z.string().min(1),
  captureEnvironment: environmentSchema, screenshotSha256: sha256,
  inkCoverageRatio: fraction,
}).strict();
const captureSchema = z.object({
  routeId: z.string().min(1), state: z.string().min(1),
  measurementPath: z.string().startsWith("/"),
  viewport: viewportSchema, metrics: metricsSchema,
  predecessor: predecessorSchema.nullable(),
}).strict();
const packetSchema = z.object({
  version: z.literal(1), source: sourceSchema, captureEnvironment: environmentSchema,
  measurementModuleSha256: sha256, computationModuleSha256: sha256,
  captures: z.array(captureSchema).min(1),
}).strict();

export type DensityCurrentPacket = z.infer<typeof packetSchema>;
export interface DensityRegister {
  routes: { id: string; path: string; kind: string; surface: string; auth?: string; stateProfile?: string;
    notApplicableStates?: Record<string, string> }[];
  stateProfiles: Record<string, { supported: string[] }>;
}
export interface DensityContract {
  baseline: { commitSha: string; routeCount: number; captureCount: number };
  capture: { artifacts: { measurementModule: { sha256: string }; measurementHarness: { sha256: string } } };
  routes: { route: string; state: string }[];
  relativeComparison: { routes: { baselineRoute: string; successorRouteId: string }[] };
}

// The existing 14 September decision identifies these three invented result
// predecessors. It does not exempt the other five authenticated predecessors.
const inventedPredecessors = new Set(["/ancestry", "/reports", "/dashboard"]);
const domainLandings = new Set(["app.overview", "genome.subject", "family.index", "embryos.index"]);
const authFormHeadings: Record<string, string> = {
  "auth.sign-in": "Welcome back", "auth.sign-up": "Create your account",
  "auth.forgot-password": "Reset your password", "auth.reset-password": "Choose a new password",
};
const viewports = viewportSchema.options;
const key = (id: string, state: string, viewport: string) => JSON.stringify([id, state, viewport]);

export function requiredDensityCaptures(register: DensityRegister) {
  const pages = register.routes.filter((route) => route.kind === "page");
  if (!pages.length || new Set(pages.map((route) => route.id)).size !== pages.length) {
    throw new Error("Density register must contain distinct current page routes");
  }
  return pages.flatMap((route) => {
    if (!["hub", "standard", "reading", "flow", "wide-data", "marketing"].includes(route.surface)
      || Object.values(route.notApplicableStates ?? {}).some((reason) => !reason.trim())) {
      throw new Error(`Unknown density surface or undocumented state waiver: ${route.id}`);
    }
    const supported = register.stateProfiles[route.stateProfile ?? ""]?.supported;
    if (!supported?.length || new Set(supported).size !== supported.length) {
      throw new Error(`Missing or duplicate density states: ${route.id}`);
    }
    const states = supported.filter((state) => !Object.hasOwn(route.notApplicableStates ?? {}, state));
    if (!states.length) throw new Error(`No applicable density state: ${route.id}`);
    return states.flatMap((state) => viewports.map((viewport) => ({ route, state, viewport })));
  });
}

function sameEnvironment(a: z.infer<typeof environmentSchema>, b: z.infer<typeof environmentSchema>) {
  return (Object.keys(a) as (keyof typeof a)[]).every((field) => a[field] === b[field]);
}

function concretePathMatches(pattern: string, concrete: string) {
  if (concrete.includes("?") || concrete.includes("#") || concrete.includes("[")
    || concrete.includes("\\") || concrete.includes("%") || concrete.includes("//")) return false;
  const expected = pattern.split("/");
  const actual = concrete.split("/");
  return expected.length === actual.length && expected.every((part, index) =>
    /^\[[a-zA-Z][a-zA-Z0-9]*\]$/.test(part)
      ? /^[a-zA-Z0-9._-]+$/.test(actual[index]) && ![".", ".."].includes(actual[index])
      : part === actual[index]);
}

/**
 * Refuses incomplete inventories and numerical budget breaches. A caller must
 * still recompute every PNG with the unchanged measurement modules and prove
 * fixture/current-source correspondence; this return is not G2.5 acceptance.
 */
export function verifyCurrentDensity(
  input: unknown, register: DensityRegister, contract: DensityContract,
  currentSource: z.infer<typeof sourceSchema>,
) {
  const packet = packetSchema.parse(input);
  const source = sourceSchema.parse(currentSource);
  if (packet.source.head !== source.head || packet.source.tree !== source.tree
    || packet.source.registerSha256 !== source.registerSha256) throw new Error("Stale density source");
  if (contract.baseline.commitSha !== "864736979c92a08ba77e8580d61946eba6864918"
    || contract.baseline.routeCount !== 22 || contract.baseline.captureCount !== 44) {
    throw new Error("Density baseline changed");
  }
  if (packet.measurementModuleSha256 !== contract.capture.artifacts.measurementModule.sha256
    || packet.computationModuleSha256 !== contract.capture.artifacts.measurementHarness.sha256) {
    throw new Error("Density measurement module changed");
  }
  const required = requiredDensityCaptures(register);
  const expected = new Map(required.map((row) => [key(row.route.id, row.state, row.viewport), row]));
  const seen = new Set<string>();
  let relativeComparisons = 0;
  for (const capture of packet.captures) {
    const identity = key(capture.routeId, capture.state, capture.viewport);
    const row = expected.get(identity);
    if (!row || seen.has(identity)) throw new Error(`Unknown or duplicate density capture: ${identity}`);
    seen.add(identity);
    if (!concretePathMatches(row.route.path, capture.measurementPath)) throw new Error("Wrong density route");
    const m = capture.metrics;
    const [width, height] = capture.viewport.split("x").map(Number);
    if (m.screenshotWidthPx !== width || m.screenshotHeightPx !== height
      || m.includedPixelCount + m.excludedPixelCount !== width * height
      || m.inkPixelCount > m.includedPixelCount
      || m.inkCoverageRatio !== Number((m.inkPixelCount / m.includedPixelCount).toFixed(6))
      || m.whiteSpaceRatio !== Number((1 - m.inkCoverageRatio).toFixed(6))
      || m.interactiveElementCount > m.rawInteractiveElementCount
      || m.budgetedDecoratedElementCount > m.rawDecoratedElementCount) throw new Error("Inconsistent density measurements");
    if ((m.proseElementCount === 0) !== (m.maxProseMeasureCh === null && m.minProseMeasureCh === null)
      || (m.proseElementCount > 0 && (m.maxProseMeasureCh === null || m.minProseMeasureCh === null
        || m.minProseMeasureCh > m.maxProseMeasureCh))
      || (m.topLevelSectionCount < 2) !== (m.minimumAdjacentSectionGapPx === null)
      || (m.primaryClaimTextElementCount === null) !== (m.primaryClaimFigureCount === null)) {
      throw new Error("Missing density geometry");
    }
    const floor = row.route.surface === "wide-data" ? 0.45
      : ["hub", "standard"].includes(row.route.surface) ? 0.62 : 0;
    const actions = row.route.surface === "wide-data" ? 24
      : row.route.surface === "flow" || (row.route.id === "app.overview" && row.state === "empty") ? 7
      : ["hub", "standard"].includes(row.route.surface) ? 12 : null;
    if (m.whiteSpaceRatio < floor
      || (actions !== null && m.interactiveElementCount > actions)
      || m.visibleTextCharacterCount > (domainLandings.has(row.route.id) ? 480 : 700)
      || m.budgetedDecoratedElementCount > (width === 390 ? 40 : 60)
      || (m.maxProseMeasureCh !== null && m.maxProseMeasureCh > 68)
      || (width >= 640 && m.minProseMeasureCh !== null && m.minProseMeasureCh < 45)
      || (m.minimumAdjacentSectionGapPx !== null && m.minimumAdjacentSectionGapPx < (width >= 1024 ? 96 : width >= 768 ? 80 : 64))
      || (width === 390 && (m.primaryContentLeftPaddingPx < 24
        || (m.primaryClaimTextElementCount !== null && m.primaryClaimTextElementCount > 7)
        || (m.primaryClaimFigureCount !== null && m.primaryClaimFigureCount > 1)))) {
      throw new Error(`Density budget exceeded: ${identity}`);
    }
    const predecessor = contract.relativeComparison.routes.find((entry) => entry.successorRouteId === row.route.id);
    const baseline = contract.routes.find((entry) => entry.route === predecessor?.baselineRoute);
    // Only the true initial form corresponds to the frozen auth empty form.
    // Processing and completed receipts keep their own current states; the
    // historical sign-in/reset outcome waivers never remove these four forms.
    const initialAuthForm = row.route.stateProfile === "auth-density-flow" && row.state === "initial-form"
      && row.route.auth === "public" && Object.hasOwn(authFormHeadings, row.route.id)
      && row.route.path === `/auth/${row.route.id.slice("auth.".length)}`;
    const matchingState = baseline?.state === row.state || (initialAuthForm && baseline?.state === "empty");
    const comparable = predecessor && matchingState && !inventedPredecessors.has(predecessor.baselineRoute);
    if (comparable) {
      const before = capture.predecessor;
      if (!before || before.baselineRoute !== predecessor.baselineRoute || before.state !== baseline?.state
        || !sameEnvironment(before.captureEnvironment, packet.captureEnvironment)) throw new Error("Missing comparable predecessor");
      if (initialAuthForm && m.statusView !== authFormHeadings[row.route.id]) {
        throw new Error("Auth receipt or loading view cannot replace the initial form");
      }
      // Compare unrounded values to the unchanged 60% ceiling. Rounding a
      // displayed ratio must never turn an over-budget capture into a pass.
      if (m.inkCoverageRatio > before.inkCoverageRatio * 0.6) throw new Error("Relative density budget exceeded");
      relativeComparisons += 1;
    } else if (capture.predecessor !== null) throw new Error("Invented density predecessor");
  }
  if (seen.size !== expected.size) throw new Error(`Missing density captures: ${expected.size - seen.size}`);
  return { status: "WITHIN_NUMERIC_BUDGETS" as const, pageRoutes: new Set(required.map((row) => row.route.id)).size,
    captures: seen.size, relativeComparisons, g2_5Acceptance: false as const };
}
