import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { captureCurrentDensity, type CurrentDensityCaptureOptions, type DensityStateFixture } from "../e2e/helpers/density-current-capture";
import { assembleRealDensityFixtures, type DensityRuntimeFixtureAssemblyInput } from "../e2e/helpers/density-runtime-fixture-assembly";
import { densityStateKey, type DensityStateCase, type DENSITY_VIEWPORTS } from "./density-capture-plan";
import type { DensityRegister } from "./density-current";
import { acquireFreshDensityRuntime, type FreshDensityRuntime } from "./density-fresh-runtime";
import type { OwnedLinuxCapability } from "./owned-linux-runtime";
import type { DensityCaptureSegmentSelection } from "./density-segments";
import type { DensityBaselineOriginalsInput } from "./density-baseline-originals";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Provider = keyof DensityRuntimeFixtureAssemblyInput;
/** Root retains the actual source/native/session observer for each provider.
 * Resource acquisition supplies none of these proofs from labels or hashes. */
export type DensityNativeObservers = {
  [K in Provider]: Pick<NonNullable<DensityRuntimeFixtureAssemblyInput[K]>, "observeState">;
};
const providerPorts: Record<Provider, 3100 | 3102 | 3103 | 3104 | 3105> = {
  publicAndAuth: 3100, accountAndOwn: 3100, pairedFamily: 3100, ownReport: 3100,
  cohortEntry: 3100, fileTransfer: 3100, publishedCohort: 3105, unansweredCopilot: 3100,
  jurisdiction: 3100, liveCohort: 3105, withdrawal: 3100, claimProcessing: 3100,
  statisticalCohort: 3105, appealReview: 3102, claimReview: 3100, subjectAccessProcessing: 3102,
  portrait: 3100, healthPicture: 3100, overviewJurisdiction: 3100,
  remainingCopilot: 3100, finalizedEmbryoEmpty: 3105,
};

export function sameDensityFixture(expected: DensityStateFixture, actual: DensityStateFixture) {
  for (const key of ["routeId", "state", "serviceOrigin", "sourcePath", "sourceSha256"] as const)
    assert(actual[key] === expected[key], "The freshly built real fixture differs from its whole source catalog");
}

/** Calls the original provider once, within its existing fresh-runtime hook.
 * This is a delegation into this already owned fixture, never stack adoption. */
export function densityNativeRuntimeHook(lease: FreshDensityRuntime,
  selected: { row: DensityStateCase; viewport: Viewport }, active: () => boolean) {
  let attempted = false, completed = false;
  return {
    withFreshNativeRuntime: async <T>(row: DensityStateCase, viewport: Viewport,
      work: (environment: FreshDensityRuntime["environment"], operator?: OwnedLinuxCapability) => Promise<T>) => {
      assert(active() && !attempted && densityStateKey(row.route.id, row.state) === densityStateKey(selected.row.route.id, selected.row.state)
        && JSON.stringify(viewport) === JSON.stringify(selected.viewport), "Exact once-owned fixture callback required");
      attempted = true;
      const result = await work(lease.environment, lease.operator);
      assert(active(), "Fresh fixture ownership ended during native work"); completed = true;
      return result;
    },
    assertCompleted: () => { assert(!attempted || completed, "Uncertain native fixture work cannot be accepted"); },
  };
}

function assemblyInput(root: string, register: DensityRegister, lease: FreshDensityRuntime,
  observers: DensityNativeObservers, selected: { row: DensityStateCase; viewport: Viewport }, active: () => boolean) {
  const hook = densityNativeRuntimeHook(lease, selected, active);
  const findActualInvitation = (address: string) => {
    assert(active(), "Actual fixture mail is available only while its lease is live");
    return lease.messages.findLast(message => [message.to].flat().includes(address));
  };
  const entries = Object.entries(providerPorts).flatMap(([name, port]) => {
    const key = name as Provider, observer = observers[key];
    if (!observer) {
      assert(["healthPicture", "overviewJurisdiction", "remainingCopilot", "finalizedEmbryoEmpty"].includes(key), "Required actual native observer missing");
      return [];
    }
    assert(typeof observer.observeState === "function", "Actual strict native state observer required");
    const app = lease.apps.get(port); assert(app, "Actual original service child required");
    const readActualAppEnvironment = async (origin: string) => {
      assert(active(), "Actual fixture lease has ended");
      return lease.observers(origin, selected.row.route.id === "*" ? "scripts/density-owned-capture.ts" : selectedSourcePath)
        .readActualAppEnvironment(origin);
    };
    return [[name, { ...observer, root, register, browser: lease.browser, origin: `http://localhost:${port}`,
      localModelOrigin: "http://localhost:3103", findActualInvitation, actualMessages: lease.messages,
      jobsSecret: app.appEnvironment.JOBS_SECRET, withFreshNativeRuntime: hook.withFreshNativeRuntime, readActualAppEnvironment }]];
  });
  // The source path is supplied by the actual selected original factory below,
  // before a provider or its configuration observer can execute.
  let selectedSourcePath = "scripts/density-owned-capture.ts";
  return { input: Object.fromEntries(entries) as unknown as DensityRuntimeFixtureAssemblyInput,
    select: (fixture: DensityStateFixture) => { selectedSourcePath = fixture.sourcePath; }, hook };
}

/** One controller invocation is one complete capture attempt. Every subsequent
 * state/viewport acquires a new actual stack, six child services and Chromium.
 * A failed callback or physical close stops the attempt without retry. */
export async function runOwnedDensityCapture(input: {
  root: string; output: string; fontManifestPath: string;
  baselineOriginals?: DensityBaselineOriginalsInput;
  observeSource: CurrentDensityCaptureOptions["observeSource"];
  nativeObservers: (ownership: FreshDensityRuntime) => DensityNativeObservers;
  signal: AbortSignal; operator?: OwnedLinuxCapability; segment?: DensityCaptureSegmentSelection;
}) {
  const root = fs.realpathSync(input.root);
  assert(root === process.cwd(), "Exact clean owned source checkout required");
  const register = JSON.parse(fs.readFileSync(path.join(root, "docs/route-register.json"), "utf8")) as DensityRegister;
  // The first acquired browser determines the actual fixed capture environment;
  // it belongs exclusively to the first fixture, never to later fixtures.
  let first: FreshDensityRuntime | undefined = await acquireFreshDensityRuntime(input.signal, input.operator);
  let live: FreshDensityRuntime | undefined, selectedFixture: DensityStateFixture | undefined;
  const usedBrowsers = new WeakSet<Browser>();
  const invalidSelection = { row: { route: { id: "*" }, state: "*" } as DensityStateCase,
    viewport: { id: "390x844", width: 390, height: 844 } as const };
  try {
    const catalogInput = assemblyInput(root, register, first, input.nativeObservers(first), invalidSelection, () => false);
    const catalog = assembleRealDensityFixtures(catalogInput.input);
    const fixtures = catalog.map(expected => ({ ...expected, withState: async (selection, capture) => {
      assert(!live, "Density fixtures are sequential, with no overlapping resources");
      const lease = first ?? await acquireFreshDensityRuntime(input.signal, input.operator); first = undefined;
      live = lease; selectedFixture = expected;
      try {
        assert(!usedBrowsers.has(lease.browser), "A later fixture cannot reuse a prior browser"); usedBrowsers.add(lease.browser);
        const current = assemblyInput(root, register, lease, input.nativeObservers(lease), selection, () => live === lease);
        const matches = assembleRealDensityFixtures(current.input).filter(fixture => densityStateKey(fixture.routeId, fixture.state)
          === densityStateKey(expected.routeId, expected.state));
        assert(matches.length === 1, "Exactly one original fresh state factory required");
        const actual = matches[0]; sameDensityFixture(expected, actual); current.select(actual);
        // Select the source before either the original UI journey or its AppEnv
        // hook runs. Each observer uses the actual distinct service child.
        lease.observers(actual.serviceOrigin!, actual.sourcePath);
        await actual.withState(selection, capture); current.hook.assertCompleted();
      } finally {
        live = undefined; selectedFixture = undefined;
        await lease.close();
      }
    } } satisfies DensityStateFixture));
    return await captureCurrentDensity({ root, output: input.output, fontManifestPath: input.fontManifestPath,
      browser: first.browser, fixtures, observeSource: input.observeSource,
      ...(input.baselineOriginals === undefined ? {} : { baselineOriginals: input.baselineOriginals }),
      ...(input.segment === undefined ? {} : { segment: input.segment }),
      readOwnedBrowser: () => { assert(live && selectedFixture, "Actual live owned fixture browser required"); return live.browser; },
      observeRuntime: (origin, digest) => {
        assert(live && selectedFixture && digest === selectedFixture.sourceSha256, "Exact live source and resource callback required");
        return live.observers(origin, selectedFixture.sourcePath).observeRuntime(origin, digest);
      },
      readActualAppEnvironment: origin => {
        assert(live && selectedFixture, "Actual live original service required");
        return live.observers(origin, selectedFixture.sourcePath).readActualAppEnvironment(origin);
      } });
  } finally { await first?.close(); }
}
