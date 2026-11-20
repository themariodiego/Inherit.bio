import assert from "node:assert/strict";
import { densityEarlyCaptureStep, densityEarlyCaptureAsyncStep, type DensityEarlyCaptureObserver } from "../../scripts/density-early-capture";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Browser, Page } from "@playwright/test";
import { DENSITY_CORRECTED_READINGS_MODULE_SHA256, TEXT_ONLY_FLOOR_VARIANT_SHA256, verifyCurrentDensity,
  type DensityContract, type DensityCurrentPacket, type DensityRegister } from "../../scripts/density-current";
import { checkedDensityStateProof, densityCapturePlan, densityRouteMatches,
  densitySourceSchema, densityStateKey, DENSITY_VIEWPORTS, type DensityStateCase, type DensitySource } from "../../scripts/density-capture-plan";

import { assertDensityServiceUnchanged, densityServicePort, observeDensityServiceBinding } from "../../scripts/density-service-binding";
import { checkedDensityCaptureSegment, type DensityCaptureSegmentSelection } from "../../scripts/density-segments";
import { connectDensityPredecessor, readPinnedDensityBaselineOriginals, type DensityBaselineOriginalsInput } from "../../scripts/density-baseline-originals";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type Predecessor = DensityCurrentPacket["captures"][number]["predecessor"];
export interface DensityStateSession {
  page: Page;
  /** Reassert actual UI and complete current native facts, with the real
   * request held when applicable. Never derive a state from its test title. */
  observe: () => Promise<unknown>;
  predecessor?: (viewport: string) => Promise<Predecessor>;
}
export interface DensityStateFixture {
  routeId: string; state: string;
  /** Set by the assembly from this provider's actual original service. */
  serviceOrigin?: string;
  /** Exact source bytes for the reviewed real journey, not an output JSON. */
  sourcePath: string;
  sourceSha256: string;
  withState: (input: { row: DensityStateCase; viewport: typeof DENSITY_VIEWPORTS[number] },
    capture: (state: DensityStateSession) => Promise<void>) => Promise<void>;
}
export interface CurrentDensityCaptureOptions {
  root: string; output: string; browser: Browser;
  /** Root supplies the existing owned runtime's actual complete observer.
   * There is no launcher, credential field, fixture insertion or new gate. */
  observeRuntime: (origin: string, fixtureSourceSha256: string) => Promise<unknown>;
  /** Root reads the selected live service's actual scoped launch values.
   * Raw values are checked in memory and are never saved. */
  readActualAppEnvironment?: (origin: string) => Promise<unknown>;
  /** Explicit per-fixture ownership; the existing fixed-browser path is unchanged. */
  readOwnedBrowser?: () => Browser;
  /** One exact capture, after the unchanged complete census/provider preflight. */
  segment?: DensityCaptureSegmentSelection;
  /** Optional owned caller only; closed metadata never becomes capture proof. */
  observeEarlyCaptureFailure?: DensityEarlyCaptureObserver;
  observeSource: () => Promise<DensitySource>;
  fontManifestPath: string;
  /** Separate genuine Root originals; no metadata is added to the font identity. */
  baselineOriginals?: DensityBaselineOriginalsInput;
  fixtures: readonly DensityStateFixture[];
}

function publicBytes(file: string) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor), bytes = fs.readFileSync(descriptor), after = fs.fstatSync(descriptor);
    assert(before.isFile() && before.nlink === 1 && before.dev === after.dev && before.ino === after.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    "Stable ordinary public source required");
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function writeOriginal(file: string, bytes: string | Buffer) {
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

/** Actual Playwright driver, separate from the frozen 22-route driver.
 * It captures no partial census: missing real fixtures are saved as HOLD
 * before opening any state. Measurement never becomes a suite pass. */
export async function captureCurrentDensity(options: CurrentDensityCaptureOptions) {
  const root = fs.realpathSync(options.root), output = path.resolve(options.output);
  assert(path.isAbsolute(options.output) && output !== root && !output.startsWith(`${root}${path.sep}`),
    "Fresh out-of-checkout density output required");
  densityEarlyCaptureStep("density-capture-output-create", () => fs.mkdirSync(output, { mode: 0o700 }), options.observeEarlyCaptureFailure); // EXCL: an existing directory is not adopted.
  const registerPath = path.join(root, "docs/route-register.json"), registerBytes = densityEarlyCaptureStep("density-capture-register-source", () => publicBytes(registerPath), options.observeEarlyCaptureFailure);
  const register = densityEarlyCaptureStep("density-capture-register-parse", () => JSON.parse(registerBytes.toString("utf8")) as DensityRegister, options.observeEarlyCaptureFailure);
  const contractPath = path.join(root, "docs/density-baseline.json"), contractBytes = densityEarlyCaptureStep("density-capture-contract-source", () => publicBytes(contractPath), options.observeEarlyCaptureFailure);
  const contract = densityEarlyCaptureStep("density-capture-contract-parse", () => JSON.parse(contractBytes.toString("utf8")) as DensityContract & { measurementSelectors: Record<string, string> }, options.observeEarlyCaptureFailure);
  const observedSource = await densityEarlyCaptureAsyncStep("density-capture-current-source", () => options.observeSource(), options.observeEarlyCaptureFailure);
  const source = densityEarlyCaptureStep("density-capture-source-parse", () => densitySourceSchema.parse(observedSource), options.observeEarlyCaptureFailure);
  densityEarlyCaptureStep("density-capture-register-match", () => assert(source.registerSha256 === sha256(registerBytes), "Current full register source required"), options.observeEarlyCaptureFailure);
  const fixtures = new Map(options.fixtures.map(f => [densityStateKey(f.routeId, f.state), f]));
  const plan = densityEarlyCaptureStep("density-capture-census-plan", () => densityCapturePlan(register, options.fixtures.map(f => densityStateKey(f.routeId, f.state))), options.observeEarlyCaptureFailure);
  densityEarlyCaptureStep("density-capture-census-write", () => writeOriginal(path.join(output, "current-census.json"), JSON.stringify({ version: 1, source,
    registerSha256: sha256(registerBytes), pageRoutes: plan.pages.map(p => p.id),
    states: plan.states.map(s => ({ routeId: s.route.id, state: s.state })),
    viewports: DENSITY_VIEWPORTS, requiredCaptureCount: plan.requiredCaptureCount, holds: plan.holds }, null, 2)), options.observeEarlyCaptureFailure);
  if (plan.holds.length) {
    const hold = { status: plan.status, g2_5Acceptance: false, captures: 0,
      pageRoutes: plan.pages.length, requiredCaptureCount: plan.requiredCaptureCount, holds: plan.holds };
    writeOriginal(path.join(output, "actual-capture-result.json"), JSON.stringify(hold, null, 2));
    return hold;
  }
  const serviceHolds = options.fixtures.flatMap(fixture => {
    try { assert(fixture.serviceOrigin); densityServicePort(fixture.serviceOrigin); return []; }
    catch { return [{ routeId: fixture.routeId, state: fixture.state, reason: "exact-provider-service-origin-missing" }]; }
  });
  if (typeof options.observeRuntime !== "function" || typeof options.readActualAppEnvironment !== "function")
    serviceHolds.push({ routeId: "*", state: "*", reason: "actual-runtime-or-AppEnv-observer-missing" });
  if (serviceHolds.length) {
    const hold = { status: "HOLD_CURRENT_DENSITY_SERVICE_BINDINGS", g2_5Acceptance: false,
      captures: 0, pageRoutes: plan.pages.length, requiredCaptureCount: plan.requiredCaptureCount, holds: serviceHolds };
    writeOriginal(path.join(output, "actual-capture-result.json"), JSON.stringify(hold, null, 2));
    return hold;
  }
  const readActualAppEnvironment = options.readActualAppEnvironment;
  assert(readActualAppEnvironment, "Actual selected service configuration observer required");
  const selection = options.segment === undefined ? undefined : checkedDensityCaptureSegment(options.segment, plan);
  const fontBytes = publicBytes(options.fontManifestPath);
  const browserVersion = options.browser.version();
  assert(options.browser.browserType().name() === "chromium", "Fixed Chromium capture required");
  const environment: DensityCurrentPacket["captureEnvironment"] = {
    browserName: "chromium", browserVersion, platform: `${os.platform()}/${os.arch()}/${os.release()}`,
    fontManifestSha256: sha256(fontBytes), theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC",
  };
  const measurementPath = path.join(root, "scripts/density-baseline/measure.mjs");
  const computationPath = path.join(root, "scripts/density-baseline/compute.mjs");
  const measurementBytes = publicBytes(measurementPath), computationBytes = publicBytes(computationPath);
  assert(sha256(measurementBytes) === contract.capture.artifacts.measurementModule.sha256
    && sha256(computationBytes) === contract.capture.artifacts.measurementHarness.sha256, "Frozen measurement source changed");
  const { ready, measure } = await import("../../scripts/density-baseline/measure.mjs");
  // The owner's corrected readings (2026-10-22) come from their own pinned
  // module, never from the frozen one, on the same live page.
  const readingsPath = path.join(root, "scripts/density-corrected-readings.mjs"), readingsBytes = publicBytes(readingsPath);
  assert(sha256(readingsBytes) === DENSITY_CORRECTED_READINGS_MODULE_SHA256, "Pinned corrected density readings required");
  const { readCorrectedDensity, captureTextOnlyFloor, TEXT_ONLY_FLOOR_CSS } = await import("../../scripts/density-corrected-readings.mjs");
  assert(sha256(TEXT_ONLY_FLOOR_CSS) === TEXT_ONLY_FLOOR_VARIANT_SHA256, "Pinned text-only floor variant required");
  const { imageMetrics, verifyFrozenDensityPixelBody } = await import("../../scripts/density-current-pixels.mjs");
  verifyFrozenDensityPixelBody(root, contract.capture.artifacts.measurementHarness.sha256);
  const baselineOriginals = options.baselineOriginals === undefined ? undefined
    : readPinnedDensityBaselineOriginals(options.baselineOriginals, { root, source, captureEnvironment: environment, contract });
  const captures: unknown[] = [];
  const originals: object[] = [];
  const targetHolds: object[] = [];
  const assertBookend = async () => {
    assert(JSON.stringify(densitySourceSchema.parse(await options.observeSource())) === JSON.stringify(source)
      && sha256(publicBytes(registerPath)) === source.registerSha256
      && sha256(publicBytes(contractPath)) === sha256(contractBytes)
      && sha256(publicBytes(measurementPath)) === sha256(measurementBytes)
      && sha256(publicBytes(computationPath)) === sha256(computationBytes)
      && sha256(publicBytes(readingsPath)) === sha256(readingsBytes)
      && sha256(publicBytes(options.fontManifestPath)) === sha256(fontBytes),
    "Density source/font bookend changed");
  };
  for (const row of plan.states) {
    const fixture = fixtures.get(densityStateKey(row.route.id, row.state))!;
    const fixturePath = path.resolve(root, fixture.sourcePath);
    assert(fixturePath.startsWith(`${root}${path.sep}`)
      && sha256(publicBytes(fixturePath)) === fixture.sourceSha256, "Reviewed real fixture source required");
    for (const viewport of DENSITY_VIEWPORTS) {
      if (selection && (selection.routeId !== row.route.id || selection.state !== row.state || selection.viewport !== viewport.id)) continue;
      await assertBookend();
      let count = 0;
      await fixture.withState({ row, viewport }, async session => {
        assert(++count === 1, "One actual capture per state and viewport required");
        const page = session.page;
        const admittedBrowser = options.readOwnedBrowser?.();
        assert(options.readOwnedBrowser
          ? admittedBrowser && page.context().browser() === admittedBrowser && admittedBrowser.isConnected()
            && admittedBrowser.browserType().name() === "chromium" && admittedBrowser.version() === browserVersion
          : page.context().browser() === options.browser, "Admitted owned browser required");
        const serviceOrigin = fixture.serviceOrigin;
        assert(serviceOrigin, "Exact original provider service required");
        const observeService = () => observeDensityServiceBinding({ origin: serviceOrigin, source,
          fixtureSourceSha256: fixture.sourceSha256, observeRuntime: options.observeRuntime, readActualAppEnvironment });
        // Each genuinely fresh provider owns its own runtime. Observe it only
        // within this live callback, never before startup or after teardown.
        const serviceBinding = await observeService();
        const { runtime, runtimeSha256 } = serviceBinding;
        const predecessorSession = connectDensityPredecessor(session, row, runtime.buildId, baselineOriginals);
        const assertCaptureBookend = async () => {
          await assertBookend();
          assertDensityServiceUnchanged(serviceBinding, await observeService());
        };
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await ready(page); // Same frozen rest/scroll/animation rule as the predecessor.
        const navigation = new URL(page.url());
        assert(["http:"].includes(navigation.protocol) && ["localhost", "127.0.0.1"].includes(navigation.hostname)
          && navigation.origin === runtime.appOrigin
          && densityRouteMatches(row.route.path, navigation.href, runtime.appOrigin), "Exact admitted local registered route required");
        const settings = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
          dpr: devicePixelRatio, light: !matchMedia("(prefers-color-scheme: dark)").matches,
          locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          documentShaInput: document.body.innerText.replace(/\s+/g, " ").trim() }));
        assert(settings.width === viewport.width && settings.height === viewport.height && settings.dpr === 1
          && settings.light && settings.locale === "en-US" && settings.timezone === "UTC", "Fixed capture environment required");
        await assertCaptureBookend();
        const expected = { row, source, runtimeSha256, navigationSha256: sha256(navigation.href), fixtureSourceSha256: fixture.sourceSha256 };
        const before = checkedDensityStateProof(await session.observe(), expected);
        const stem = sha256(densityStateKey(row.route.id, row.state));
        const screenshotFile = `${stem}__${viewport.id}.png`, screenshotPath = path.join(output, screenshotFile);
        const screenshot = await page.screenshot({ type: "png", fullPage: false, animations: "disabled", caret: "hide" });
        writeOriginal(screenshotPath, screenshot);
        const raw = await measure(page, contract.measurementSelectors);
        assert(raw.ground === "rgb(247, 248, 241)" && raw.resolvedUrl === navigation.href
          && raw.innerWidth === viewport.width && raw.innerHeight === viewport.height && raw.dpr === 1,
        "Unchanged DOM measurement must correspond to the actual PNG");
        const pixel = await imageMetrics(screenshotPath, viewport.width, viewport.height, raw.pixelExclusionRects);
        assert(pixel.screenshotSha256 === sha256(screenshot) && sha256(publicBytes(screenshotPath)) === sha256(screenshot),
          "Exact saved screenshot bytes required");
        // The same capture, read for the corrected rules and then as its
        // text-only floor; the floor style is removed again before the
        // after-proof below, so the state checks see the original page.
        const correctedReadings = { moduleSha256: sha256(readingsBytes),
          ...(await readCorrectedDensity(page, contract.measurementSelectors)) };
        const floorShot = await captureTextOnlyFloor(page);
        const floorFile = `${stem}__${viewport.id}__text-only-floor.png`, floorPath = path.join(output, floorFile);
        writeOriginal(floorPath, floorShot);
        const floorPixel = await imageMetrics(floorPath, viewport.width, viewport.height, raw.pixelExclusionRects);
        assert(floorPixel.screenshotSha256 === sha256(floorShot) && sha256(publicBytes(floorPath)) === sha256(floorShot),
          "Exact saved text-only floor bytes required");
        const textOnlyFloor = { variantSha256: sha256(TEXT_ONLY_FLOOR_CSS), screenshotSha256: floorPixel.screenshotSha256,
          screenshotWidthPx: floorPixel.screenshotWidthPx, screenshotHeightPx: floorPixel.screenshotHeightPx,
          includedPixelCount: floorPixel.includedPixelCount, excludedPixelCount: floorPixel.excludedPixelCount,
          inkPixelCount: floorPixel.inkPixelCount, inkCoverageRatio: floorPixel.inkCoverageRatio };
        const targets = await page.evaluate(() => [...document.querySelectorAll(
          'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"]')]
          .map(element => ({ element, rect: element.getBoundingClientRect(), style: getComputedStyle(element) }))
          .filter(({ rect, style }) => rect.width > 0 && rect.height > 0 && style.display !== "none"
            && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0)
          .map(({ rect }) => ({ width: rect.width, height: rect.height })));
        const smallTargets = targets.filter(target => target.width < 44 || target.height < 44);
        if (smallTargets.length) targetHolds.push({ routeId: row.route.id, state: row.state, viewport: viewport.id,
          reason: "44px-target-breach", count: smallTargets.length });
        const after = checkedDensityStateProof(await session.observe(), expected);
        const afterText = await page.locator("body").innerText();
        assert(JSON.stringify(before) === JSON.stringify(after)
          && sha256(afterText.replace(/\s+/g, " ").trim()) === sha256(settings.documentShaInput), "Actual state changed during density capture");
        const metrics = { ...pixel, interactiveElementCount: raw.budgetedInteractiveElements,
          rawInteractiveElementCount: raw.interactiveElements, rawDecoratedElementCount: raw.rawDecoratedElements,
          budgetedDecoratedElementCount: raw.budgetedDecoratedElements, visibleTextCharacterCount: raw.visibleTextCharacters,
          statusView: raw.statusView, proseElementCount: raw.proseElementCount, maxProseMeasureCh: raw.maxProseMeasureCh,
          minProseMeasureCh: raw.minProseMeasureCh, topLevelSectionCount: raw.topLevelSectionCount,
          minimumAdjacentSectionGapPx: raw.minimumAdjacentSectionGapPx, primaryContentLeftPaddingPx: raw.primaryContentLeftPaddingPx,
          primaryClaimTextElementCount: raw.primaryClaimTextElementCount, primaryClaimFigureCount: raw.primaryClaimFigureCount,
          horizontalScroll: raw.horizontalScroll, horizontalOverflowPx: raw.horizontalOverflowPx };
        const predecessor = predecessorSession.predecessor ? await predecessorSession.predecessor(viewport.id) : null;
        // Concrete paths are used only in memory by the numeric verifier.
        // Bearer URLs, queries, form text and credentials are never serialized.
        captures.push({ routeId: row.route.id, state: row.state, viewport: viewport.id,
          measurementPath: navigation.pathname, metrics, predecessor, textOnlyFloor, correctedReadings });
        const safeRaw = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "resolvedUrl"));
        await assertCaptureBookend();
        originals.push({ routeId: row.route.id, state: row.state, viewport: viewport.id, serviceBinding,
          registeredPath: row.route.path, navigationSha256: sha256(navigation.href), screenshotFile,
          screenshotSha256: pixel.screenshotSha256, documentSha256: sha256(settings.documentShaInput),
          nativeProofBefore: before, nativeProofAfter: after, rawMeasurement: safeRaw, metrics, predecessor,
          targetCount: targets.length, undersizedTargetCount: smallTargets.length, textOnlyFloor, correctedReadings });
        writeOriginal(path.join(output, `${stem}__${viewport.id}.json`), JSON.stringify(originals.at(-1), null, 2));
        await assertCaptureBookend();
      });
      assert(count === 1 && sha256(publicBytes(fixturePath)) === fixture.sourceSha256, "Actual fixture must yield once and settle unchanged");
      await assertBookend();
    }
  }
  if (selection) {
    assert(captures.length === 1 && originals.length === 1, "Exact selected capture must complete once");
    await assertBookend();
    const packet = { version: 1, source, captureEnvironment: environment,
      measurementModuleSha256: sha256(measurementBytes), computationModuleSha256: sha256(computationBytes), captures };
    const result = { version: 1, kind: "density-capture-segment-v1", status: "CAPTURED_SEGMENT_EXTERNAL_CLOSURE_PENDING",
      selection, source, captureEnvironment: environment,
      fixtureCatalog: options.fixtures.map(f => ({ routeId: f.routeId, state: f.state, serviceOrigin: f.serviceOrigin,
        sourcePath: f.sourcePath, sourceSha256: f.sourceSha256 })), packet,
      requiredCaptureCount: plan.requiredCaptureCount, remainingCaptureCount: plan.requiredCaptureCount - 1,
      captures: originals.length, originalsSha256: sha256(JSON.stringify(originals)), targetHolds,
      resumable: false, g2_5Acceptance: false };
    writeOriginal(path.join(output, "actual-capture-result.json"), JSON.stringify(result, null, 2));
    return result;
  }
  assert(captures.length === plan.requiredCaptureCount, "Complete current capture census required");
  const packet = { version: 1, source, captureEnvironment: environment,
    measurementModuleSha256: sha256(measurementBytes), computationModuleSha256: sha256(computationBytes), captures };
  let numeric: ReturnType<typeof verifyCurrentDensity> | null = null;
  try { numeric = verifyCurrentDensity(packet, register, contract, source); } catch { /* Fixed HOLD below; originals retain actual metrics. */ }
  // The binding status reads the owner's corrected rules (2026-10-22); the
  // contract-basis verdict stays beside it.
  let correctedNumeric: ReturnType<typeof verifyCurrentDensity> | null = null;
  try { correctedNumeric = verifyCurrentDensity(packet, register, contract, source, "corrected-2026-10-22"); } catch { /* HOLD below. */ }
  await assertBookend();
  const result = { version: 1, status: correctedNumeric && !targetHolds.length ? "COMPLETE_MEASUREMENT_WITHIN_NUMERIC_BUDGETS" : "HOLD_CURRENT_DENSITY_BUDGETS",
    rules: "corrected-2026-10-22", contractStatus: numeric ? "WITHIN_CONTRACT_BUDGETS" : "OUTSIDE_CONTRACT_BUDGETS",
    g2_5Acceptance: false, source, runtimeScope: "per-capture-actual-service", captureEnvironment: environment, pageRoutes: plan.pages.length,
    captures: originals.length, requiredCaptureCount: plan.requiredCaptureCount, numeric, correctedNumeric, targetHolds,
    measurementModuleSha256: sha256(measurementBytes), computationModuleSha256: sha256(computationBytes),
    originalsSha256: sha256(JSON.stringify(originals)) };
  writeOriginal(path.join(output, "actual-capture-result.json"), JSON.stringify(result, null, 2));
  return result;
}
