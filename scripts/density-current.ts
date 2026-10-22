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
// Owner decision "2026-10-22 — Density rule corrections (G2.5)". Both fields
// are optional and read only under the corrected rules; the contract rules
// ignore them. They come from scripts/density-corrected-readings.mjs on the
// same live page as the frozen measurement, never from the frozen modules.
const textOnlyFloorSchema = z.object({
  variantSha256: sha256, screenshotSha256: sha256,
  screenshotWidthPx: count, screenshotHeightPx: count,
  includedPixelCount: count.positive(), excludedPixelCount: count,
  inkPixelCount: count, inkCoverageRatio: fraction,
}).strict();
const correctedReadingsSchema = z.object({
  moduleSha256: sha256,
  proseParagraphCount: count, excludedOneLineLinkParagraphCount: count,
  minProseParagraphMeasureCh: dimension,
  topLevelSectionRowCount: count, minimumVisualSectionGapPx: dimension,
  aboveFoldTextCharacterCount: count,
}).strict();
const captureSchema = z.object({
  routeId: z.string().min(1), state: z.string().min(1),
  measurementPath: z.string().startsWith("/"),
  viewport: viewportSchema, metrics: metricsSchema,
  predecessor: predecessorSchema.nullable(),
  textOnlyFloor: textOnlyFloorSchema.optional(),
  correctedReadings: correctedReadingsSchema.optional(),
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

/**
 * The two rule sets. `contract` is every budget exactly as
 * docs/density-baseline.json and the brief state it, and is the default.
 * `corrected-2026-10-22` is the owner's six readings of 22 October
 * (docs/protocol/decisions.md, "Density rule corrections (G2.5)"): the same
 * 0.6 ceiling, baseline and thresholds, read as follows.
 *  1. A comparable row whose text-only floor is over 0.6 of its predecessor
 *     passes the ink rule at most 0.05 of the predecessor above that floor.
 *     Both inks come from the frozen pixel body on the same capture.
 *  3. The 45ch floor reads prose paragraphs only (D-115).
 *  4. Section gaps are read in visual order.
 *  5. Signed legal documents count only characters visible above the fold.
 *  6. Sign-in and sign-up may carry 10 interactive controls.
 * (2, keeping the outlined primary actions, is a product decision with no
 * evaluator reading.) Without its corrected reading a capture is judged on
 * the contract basis, which is never more lenient.
 */
export type DensityRules = "contract" | "corrected-2026-10-22";
export const TEXT_ONLY_FLOOR_VARIANT_SHA256 = "dd099009b40dccc61525264e9849fc8e5d51b84b62103f56f1a18bce5176a396";
export const DENSITY_CORRECTED_READINGS_MODULE_SHA256 = "f09f9b49811a9aede8b3aa338cba1f3b342bc97bbbb341e3419c1041ce908a64";
export const TEXT_BOUND_ALLOWANCE_OF_PREDECESSOR = 0.05;
export const SIGNED_LEGAL_DOCUMENT_ROUTE_IDS: readonly string[] = [
  "legal.artifact", "legal.artifact-version", "legal.artifact-diff",
  "legal.consent", "legal.consent-version", "legal.consent-diff",
  "legal.insurance-and-discrimination",
];
export const AUTH_FLOW_TEN_CONTROL_ROUTE_IDS: readonly string[] = ["auth.sign-in", "auth.sign-up"];

type Capture = z.infer<typeof captureSchema>;
type RegisterRow = ReturnType<typeof requiredDensityCaptures>[number];
export interface DensityRelativeVerdict {
  baselineRoute: string; predecessorInk: number; ink: number; ratio: number;
  floorInk: number | null; floorRatio: number | null; textBound: boolean; within: boolean;
}
export interface DensityCaptureVerdict {
  routeId: string; state: string; viewport: string;
  /** Short codes of every absolute budget the capture misses, in a fixed order. */
  budgetBreaches: string[];
  /** A predecessor refusal (missing, invented or a substituted auth receipt). */
  predecessorError: string | null;
  relative: DensityRelativeVerdict | null;
}

/**
 * One capture against every budget. Structural inconsistency throws; budget
 * misses are returned so a report can name all of them. `verifyCurrentDensity`
 * turns the first miss into the refusal it always gave.
 */
export function evaluateDensityCapture(
  row: RegisterRow, capture: Capture, contract: DensityContract,
  captureEnvironment: z.infer<typeof environmentSchema>, rules: DensityRules = "contract",
): DensityCaptureVerdict {
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
  const corrected = rules === "corrected-2026-10-22";
  const readings = corrected ? capture.correctedReadings : undefined;
  if (readings && (readings.moduleSha256 !== DENSITY_CORRECTED_READINGS_MODULE_SHA256
    || (readings.proseParagraphCount === 0) !== (readings.minProseParagraphMeasureCh === null)
    || (readings.topLevelSectionRowCount < 2) !== (readings.minimumVisualSectionGapPx === null))) {
    throw new Error("Inconsistent corrected density readings");
  }
  const floor = corrected ? capture.textOnlyFloor : undefined;
  if (floor && (floor.variantSha256 !== TEXT_ONLY_FLOOR_VARIANT_SHA256
    || floor.screenshotWidthPx !== width || floor.screenshotHeightPx !== height
    || floor.includedPixelCount !== m.includedPixelCount || floor.excludedPixelCount !== m.excludedPixelCount
    || floor.inkPixelCount > floor.includedPixelCount
    || floor.inkCoverageRatio !== Number((floor.inkPixelCount / floor.includedPixelCount).toFixed(6)))) {
    throw new Error("Inconsistent text-only floor");
  }
  const route = row.route;
  const breaches: string[] = [];
  const floorWhite = route.surface === "wide-data" ? 0.45
    : ["hub", "standard"].includes(route.surface) ? 0.62 : 0;
  const actions = route.surface === "wide-data" ? 24
    : corrected && AUTH_FLOW_TEN_CONTROL_ROUTE_IDS.includes(route.id) ? 10
    : route.surface === "flow" || (route.id === "app.overview" && row.state === "empty") ? 7
    : ["hub", "standard"].includes(route.surface) ? 12 : null;
  const characters = readings && SIGNED_LEGAL_DOCUMENT_ROUTE_IDS.includes(route.id)
    ? readings.aboveFoldTextCharacterCount : m.visibleTextCharacterCount;
  const minimumProse = readings ? readings.minProseParagraphMeasureCh : m.minProseMeasureCh;
  const gap = readings ? readings.minimumVisualSectionGapPx : m.minimumAdjacentSectionGapPx;
  if (m.whiteSpaceRatio < floorWhite) breaches.push("whiteSpace");
  if (actions !== null && m.interactiveElementCount > actions) breaches.push("interactive");
  if (characters > (domainLandings.has(route.id) ? 480 : 700)) breaches.push("visibleCharacters");
  if (m.budgetedDecoratedElementCount > (width === 390 ? 40 : 60)) breaches.push("decorated");
  if (m.maxProseMeasureCh !== null && m.maxProseMeasureCh > 68) breaches.push("proseMax");
  if (width >= 640 && minimumProse !== null && minimumProse < 45) breaches.push("proseMin");
  if (gap !== null && gap < (width >= 1024 ? 96 : width >= 768 ? 80 : 64)) breaches.push("sectionGap");
  if (width === 390 && m.primaryContentLeftPaddingPx < 24) breaches.push("leftPadding");
  if (width === 390 && m.primaryClaimTextElementCount !== null && m.primaryClaimTextElementCount > 7) breaches.push("claimText");
  if (width === 390 && m.primaryClaimFigureCount !== null && m.primaryClaimFigureCount > 1) breaches.push("claimFigures");

  const predecessor = contract.relativeComparison.routes.find((entry) => entry.successorRouteId === route.id);
  const baseline = contract.routes.find((entry) => entry.route === predecessor?.baselineRoute);
  // Only the true initial form corresponds to the frozen auth empty form.
  // Processing and completed receipts keep their own current states; the
  // historical sign-in/reset outcome waivers never remove these four forms.
  const initialAuthForm = route.stateProfile === "auth-density-flow" && row.state === "initial-form"
    && route.auth === "public" && Object.hasOwn(authFormHeadings, route.id)
    && route.path === `/auth/${route.id.slice("auth.".length)}`;
  const matchingState = baseline?.state === row.state || (initialAuthForm && baseline?.state === "empty");
  const comparable = predecessor && matchingState && !inventedPredecessors.has(predecessor.baselineRoute);
  let predecessorError: string | null = null;
  let relative: DensityRelativeVerdict | null = null;
  if (comparable) {
    const before = capture.predecessor;
    if (!before || before.baselineRoute !== predecessor.baselineRoute || before.state !== baseline?.state
      || !sameEnvironment(before.captureEnvironment, captureEnvironment)) predecessorError = "Missing comparable predecessor";
    else if (initialAuthForm && m.statusView !== authFormHeadings[route.id]) {
      predecessorError = "Auth receipt or loading view cannot replace the initial form";
    } else {
      // Compare unrounded values to the unchanged 60% ceiling. Rounding a
      // displayed ratio must never turn an over-budget capture into a pass.
      const ceiling = before.inkCoverageRatio * 0.6;
      const textBound = Boolean(floor && floor.inkCoverageRatio > ceiling
        && m.inkCoverageRatio <= floor.inkCoverageRatio + TEXT_BOUND_ALLOWANCE_OF_PREDECESSOR * before.inkCoverageRatio);
      relative = { baselineRoute: predecessor.baselineRoute, predecessorInk: before.inkCoverageRatio,
        ink: m.inkCoverageRatio, ratio: m.inkCoverageRatio / before.inkCoverageRatio,
        floorInk: floor?.inkCoverageRatio ?? null,
        floorRatio: floor ? floor.inkCoverageRatio / before.inkCoverageRatio : null,
        textBound: m.inkCoverageRatio > ceiling && textBound,
        within: m.inkCoverageRatio <= ceiling || textBound };
    }
  } else if (capture.predecessor !== null) predecessorError = "Invented density predecessor";
  return { routeId: route.id, state: row.state, viewport: capture.viewport, budgetBreaches: breaches,
    predecessorError, relative };
}

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
 * `rules` defaults to the contract; the corrected rules are opt-in.
 */
export function verifyCurrentDensity(
  input: unknown, register: DensityRegister, contract: DensityContract,
  currentSource: z.infer<typeof sourceSchema>, rules: DensityRules = "contract",
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
  let textBoundComparisons = 0;
  for (const capture of packet.captures) {
    const identity = key(capture.routeId, capture.state, capture.viewport);
    const row = expected.get(identity);
    if (!row || seen.has(identity)) throw new Error(`Unknown or duplicate density capture: ${identity}`);
    seen.add(identity);
    if (!concretePathMatches(row.route.path, capture.measurementPath)) throw new Error("Wrong density route");
    const verdict = evaluateDensityCapture(row, capture, contract, packet.captureEnvironment, rules);
    if (verdict.budgetBreaches.length) throw new Error(`Density budget exceeded: ${identity}`);
    if (verdict.predecessorError) throw new Error(verdict.predecessorError);
    if (verdict.relative) {
      if (!verdict.relative.within) throw new Error("Relative density budget exceeded");
      relativeComparisons += 1;
      if (verdict.relative.textBound) textBoundComparisons += 1;
    }
  }
  if (seen.size !== expected.size) throw new Error(`Missing density captures: ${expected.size - seen.size}`);
  return { status: "WITHIN_NUMERIC_BUDGETS" as const, rules, pageRoutes: new Set(required.map((row) => row.route.id)).size,
    captures: seen.size, relativeComparisons, textBoundComparisons, g2_5Acceptance: false as const };
}
