import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { types } from "node:util";
import { z } from "zod";
import { checkedDensityStateProof, densityCapturePlan, densityRuntimeSchema, densitySourceSchema,
  densityStateKey, DENSITY_VIEWPORTS, type DensitySource } from "./density-capture-plan";
import { requiredDensityCaptures, verifyCurrentDensity, type DensityContract, type DensityCurrentPacket,
  type DensityRegister } from "./density-current";
import { densityServicePort } from "./density-service-binding";

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const equal = (a: unknown, b: unknown) => assert.deepEqual(a, b, "Exact complete density originals required");
const selectionSchema = z.object({ routeId: z.string().min(1), state: z.string().min(1),
  viewport: z.enum(["390x844", "1280x800"]) }).strict();
export type DensityCaptureSegmentSelection = z.infer<typeof selectionSchema>;
export const densitySegmentKey = (x: DensityCaptureSegmentSelection) => JSON.stringify([x.routeId, x.state, x.viewport]);

/** Snapshot ordinary data without invoking a getter, proxy or toJSON. */
function data(value: unknown, depth = 0): unknown {
  assert(depth < 32 && !types.isProxy(value), "Ordinary density segment data required");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { assert(Number.isFinite(value)); return value; }
  assert(value && typeof value === "object");
  if (Array.isArray(value)) {
    assert(Object.getPrototypeOf(value) === Array.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    assert(Reflect.ownKeys(descriptors).every(key => key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key))));
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[String(index)]; assert(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
      return data(descriptor.value, depth + 1);
    });
  }
  assert([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    assert(typeof key === "string"); const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
    Object.defineProperty(result, key, { value: data(descriptor.value, depth + 1), enumerable: true });
  }
  return result;
}
const record = (value: unknown) => { const x = data(value); assert(x && typeof x === "object" && !Array.isArray(x)); return x as Record<string, unknown>; };
function keys(value: Record<string, unknown>, expected: readonly string[]) { equal(Object.keys(value).sort(), [...expected].sort()); }

/** Selection never shrinks the full census or bypasses a missing provider. */
export function checkedDensityCaptureSegment(input: unknown, plan: ReturnType<typeof densityCapturePlan>) {
  const selection = selectionSchema.parse(data(input));
  assert(plan.holds.length === 0 && plan.status === "READY_FOR_ACTUAL_CAPTURE", "Complete original provider census required");
  assert(plan.states.some(row => row.route.id === selection.routeId && row.state === selection.state)
    && DENSITY_VIEWPORTS.some(viewport => viewport.id === selection.viewport), "Exactly one registered density capture required");
  return selection;
}

export interface DensitySegmentOriginals {
  result: unknown; census: unknown; original: unknown;
  /** Supplied by the stable-FD reader below, never copied from result JSON. */
  screenshotSha256: string; recomputedPixel: Record<string, unknown>;
}

/** Pure complete-union validation. It confers no runtime/closure authority. */
export function validateDensitySegmentUnion(input: {
  source: DensitySource; register: DensityRegister; contract: DensityContract; segments: readonly DensitySegmentOriginals[];
}) {
  const source = densitySourceSchema.parse(data(input.source));
  const required = requiredDensityCaptures(input.register);
  const plan = densityCapturePlan(input.register, [...new Set(required.map(row => densityStateKey(row.route.id, row.state)))]);
  assert(plan.holds.length === 0 && input.segments.length === required.length, "Whole current capture union required");
  const expectedCensus = { version: 1, source, registerSha256: source.registerSha256,
    pageRoutes: plan.pages.map(row => row.id), states: plan.states.map(row => ({ routeId: row.route.id, state: row.state })),
    viewports: DENSITY_VIEWPORTS, requiredCaptureCount: required.length, holds: [] };
  const captures = new Map<string, DensityCurrentPacket["captures"][number]>();
  const owners = new Set<string>();
  let environment: unknown, modules: [unknown, unknown] | undefined, fixtureCatalog: unknown, buildId: string | undefined;
  for (const part of input.segments) {
    const result = record(part.result);
    keys(result, ["version", "kind", "status", "selection", "source", "captureEnvironment", "fixtureCatalog", "packet",
      "requiredCaptureCount", "remainingCaptureCount", "captures", "originalsSha256", "targetHolds", "resumable", "g2_5Acceptance"]);
    assert(result.version === 1 && result.kind === "density-capture-segment-v1"
      && result.status === "CAPTURED_SEGMENT_EXTERNAL_CLOSURE_PENDING" && result.captures === 1
      && result.requiredCaptureCount === required.length && result.remainingCaptureCount === required.length - 1
      && result.resumable === false && result.g2_5Acceptance === false);
    const selection = checkedDensityCaptureSegment(result.selection, plan), identity = densitySegmentKey(selection);
    assert(!captures.has(identity), "No duplicate or replacement capture is admitted");
    equal(result.source, source); equal(data(part.census), expectedCensus); equal(result.targetHolds, []);
    const packet = record(result.packet);
    keys(packet, ["version", "source", "captureEnvironment", "measurementModuleSha256", "computationModuleSha256", "captures"]);
    assert(packet.version === 1); equal(packet.source, source); equal(packet.captureEnvironment, result.captureEnvironment);
    if (environment === undefined) environment = packet.captureEnvironment; else equal(packet.captureEnvironment, environment);
    const currentModules: [unknown, unknown] = [packet.measurementModuleSha256, packet.computationModuleSha256];
    if (!modules) modules = currentModules; else equal(currentModules, modules);
    equal(currentModules, [input.contract.capture.artifacts.measurementModule.sha256, input.contract.capture.artifacts.measurementHarness.sha256]);
    assert(Array.isArray(packet.captures) && packet.captures.length === 1);
    const capture = record(packet.captures[0]);
    assert(capture.routeId === selection.routeId && capture.state === selection.state && capture.viewport === selection.viewport);
    const original = record(part.original);
    keys(original, ["routeId", "state", "viewport", "serviceBinding", "registeredPath", "navigationSha256", "screenshotFile",
      "screenshotSha256", "documentSha256", "nativeProofBefore", "nativeProofAfter", "rawMeasurement", "metrics", "predecessor",
      "targetCount", "undersizedTargetCount"]);
    const row = required.find(row => row.route.id === selection.routeId && row.state === selection.state && row.viewport === selection.viewport)!;
    assert(original.routeId === selection.routeId && original.state === selection.state && original.viewport === selection.viewport
      && original.registeredPath === row.route.path && original.undersizedTargetCount === 0
      && Number.isSafeInteger(original.targetCount) && (original.targetCount as number) >= 0);
    equal(original.metrics, capture.metrics); equal(original.predecessor, capture.predecessor);
    assert(result.originalsSha256 === sha256(JSON.stringify([original])));
    const digest = z.string().regex(/^[a-f0-9]{64}$/);
    digest.parse(original.navigationSha256); digest.parse(original.documentSha256);
    const service = record(original.serviceBinding);
    keys(service, ["version", "port", "runtime", "runtimeSha256", "appConfigurationSha256"]);
    const runtime = densityRuntimeSchema.parse(service.runtime);
    assert(service.version === 1 && service.port === densityServicePort(runtime.appOrigin));
    equal(runtime.source, source); digest.parse(service.appConfigurationSha256);
    if (buildId === undefined) buildId = runtime.buildId; else equal(runtime.buildId, buildId);
    assert(service.runtimeSha256 === sha256(JSON.stringify(runtime)) && !owners.has(runtime.ownerNonce)); owners.add(runtime.ownerNonce);
    if (fixtureCatalog === undefined) fixtureCatalog = result.fixtureCatalog; else equal(result.fixtureCatalog, fixtureCatalog);
    assert(Array.isArray(result.fixtureCatalog) && result.fixtureCatalog.length === plan.states.length);
    const fixtureKeys = new Set<string>();
    let selectedFixture: Record<string, unknown> | undefined;
    for (const item of result.fixtureCatalog) {
      const fixture = record(item); keys(fixture, ["routeId", "state", "serviceOrigin", "sourcePath", "sourceSha256"]);
      assert(typeof fixture.routeId === "string" && typeof fixture.state === "string" && typeof fixture.sourcePath === "string"
        && /^(?:e2e|scripts)\/[a-zA-Z0-9_./-]+\.(?:ts|mts|tsx)$/.test(fixture.sourcePath)
        && !fixture.sourcePath.split("/").some(part => part === "." || part === ".."));
      digest.parse(fixture.sourceSha256); assert(typeof fixture.serviceOrigin === "string"); densityServicePort(fixture.serviceOrigin);
      const key = densityStateKey(fixture.routeId, fixture.state); assert(!fixtureKeys.has(key)); fixtureKeys.add(key);
      if (fixture.routeId === selection.routeId && fixture.state === selection.state) selectedFixture = fixture;
    }
    equal([...fixtureKeys].sort(), plan.states.map(row => densityStateKey(row.route.id, row.state)).sort());
    assert(selectedFixture && runtime.appOrigin === selectedFixture.serviceOrigin && runtime.fixtureSourceSha256 === selectedFixture.sourceSha256);
    const expected = { row: { route: row.route, state: row.state }, source, runtimeSha256: service.runtimeSha256 as string,
      navigationSha256: original.navigationSha256 as string, fixtureSourceSha256: runtime.fixtureSourceSha256 };
    equal(checkedDensityStateProof(original.nativeProofBefore, expected), checkedDensityStateProof(original.nativeProofAfter, expected));
    assert(original.screenshotFile === `${sha256(densityStateKey(selection.routeId, selection.state))}__${selection.viewport}.png`
      && original.screenshotSha256 === part.screenshotSha256);
    const metrics = record(original.metrics), raw = record(original.rawMeasurement), pixel = record(part.recomputedPixel);
    keys(pixel, ["screenshotSha256", "screenshotWidthPx", "screenshotHeightPx", "includedPixelCount", "excludedPixelCount",
      "inkPixelCount", "inkCoverageRatio", "whiteSpaceRatio", "exactGroundPixelCount", "exactGroundRatio"]);
    const viewport = DENSITY_VIEWPORTS.find(value => value.id === selection.viewport)!;
    assert(raw.ground === "rgb(247, 248, 241)" && raw.innerWidth === viewport.width && raw.innerHeight === viewport.height
      && raw.dpr === 1 && !Object.hasOwn(raw, "resolvedUrl"));
    assert(metrics.screenshotSha256 === part.screenshotSha256);
    for (const [key, value] of Object.entries(pixel)) equal(metrics[key], value);
    for (const [metric, field] of Object.entries({ interactiveElementCount: "budgetedInteractiveElements", rawInteractiveElementCount: "interactiveElements",
      rawDecoratedElementCount: "rawDecoratedElements", budgetedDecoratedElementCount: "budgetedDecoratedElements", visibleTextCharacterCount: "visibleTextCharacters",
      statusView: "statusView", proseElementCount: "proseElementCount", maxProseMeasureCh: "maxProseMeasureCh", minProseMeasureCh: "minProseMeasureCh",
      topLevelSectionCount: "topLevelSectionCount", minimumAdjacentSectionGapPx: "minimumAdjacentSectionGapPx", primaryContentLeftPaddingPx: "primaryContentLeftPaddingPx",
      primaryClaimTextElementCount: "primaryClaimTextElementCount", primaryClaimFigureCount: "primaryClaimFigureCount", horizontalScroll: "horizontalScroll", horizontalOverflowPx: "horizontalOverflowPx" })) equal(metrics[metric], raw[field]);
    captures.set(identity, capture as unknown as DensityCurrentPacket["captures"][number]);
  }
  const packet = { version: 1, source, captureEnvironment: environment, measurementModuleSha256: modules![0],
    computationModuleSha256: modules![1], captures: required.map(row => {
      const capture = captures.get(densitySegmentKey({ routeId: row.route.id, state: row.state, viewport: row.viewport }));
      assert(capture); return capture;
    }) };
  const numeric = verifyCurrentDensity(packet, input.register, input.contract, source);
  return { version: 1, status: "COMPLETE_SOURCE_BOUND_SEGMENT_UNION_ROOT_CLOSURE_REQUIRED", source, packet, numeric,
    captures: required.length, remainingCaptureCount: 0, resumable: false, g2_5Acceptance: false,
    requiredActualClosureAdapter: "Root must validate original bounded parent natural outcome/reaped/group absence, exact lease release/native-empty/lock absence and source/input bookends for each owner; no JSON boolean supplies that capability." };
}

function fdPin(file: string, bytes: Buffer, stat: fs.BigIntStats) {
  return { path: file, sha256: sha256(bytes), bytes: bytes.length, dev: String(stat.dev), ino: String(stat.ino),
    uid: String(stat.uid), gid: String(stat.gid), mode: String(stat.mode), nlink: String(stat.nlink),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}
function json(bytes: Buffer): unknown {
  const text = bytes.toString("utf8"); assert(Buffer.from(text, "utf8").equals(bytes), "Exact UTF8 original required");
  return JSON.parse(text);
}
function stableBytes(file: string) {
  assert(fs.realpathSync(file) === file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true }), bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true });
    assert(before.isFile() && before.nlink === BigInt(1) && before.uid === BigInt(process.getuid!()) && (before.mode & BigInt(0o7777)) === BigInt(0o600));
    equal([before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs], [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs]);
    assert(BigInt(bytes.length) === before.size);
    return { bytes, pin: fdPin(file, bytes, before) };
  } finally { fs.closeSync(fd); }
}

/** Read only exact private segment outputs; recompute every PNG with the existing frozen algorithm.
 * This returns an offline union HOLD, never promotes missing Root closure evidence. */
export async function aggregateDensitySegmentOriginals(input: {
  root: string; directories: readonly string[]; source: DensitySource; register: DensityRegister; contract: DensityContract;
  fontManifestPath: string; observeSource: () => Promise<DensitySource>;
}) {
  const root = fs.realpathSync(input.root), pins: object[] = [];
  const currentSource = densitySourceSchema.parse(input.source);
  assert(typeof input.observeSource === "function");
  equal(densitySourceSchema.parse(data(await input.observeSource())), currentSource);
  const sourcePins = new Map<string, ReturnType<typeof fdPin>>();
  const publicBytes = (file: string) => {
    assert(fs.realpathSync(file) === file); const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const a = fs.fstatSync(fd, { bigint: true }); const bytes = fs.readFileSync(fd); const b = fs.fstatSync(fd, { bigint: true });
      assert(a.isFile() && a.nlink === BigInt(1) && BigInt(bytes.length) === a.size);
      equal([a.dev,a.ino,a.size,a.mtimeNs,a.ctimeNs], [b.dev,b.ino,b.size,b.mtimeNs,b.ctimeNs]);
      const pin = fdPin(file, bytes, a), previous = sourcePins.get(file);
      if (previous) equal(pin, previous); else sourcePins.set(file, pin);
      return { bytes, pin };
    } finally { fs.closeSync(fd); }
  };
  const register = publicBytes(path.join(root, "docs/route-register.json"));
  assert(register.pin.sha256 === currentSource.registerSha256); equal(json(register.bytes), input.register);
  equal(json(publicBytes(path.join(root, "docs/density-baseline.json")).bytes), input.contract);
  const fontHash = publicBytes(input.fontManifestPath).pin.sha256;
  assert(publicBytes(path.join(root, "scripts/density-baseline/measure.mjs")).pin.sha256 === input.contract.capture.artifacts.measurementModule.sha256
    && publicBytes(path.join(root, "scripts/density-baseline/compute.mjs")).pin.sha256 === input.contract.capture.artifacts.measurementHarness.sha256);
  publicBytes(path.join(root, "scripts/density-current-pixels.mjs"));
  publicBytes(path.join(root, "scripts/density-current.ts"));
  publicBytes(path.join(root, "scripts/density-capture-plan.ts"));
  publicBytes(path.join(root, "scripts/density-service-binding.ts"));
  publicBytes(path.join(root, "scripts/density-segments.ts"));
  const { imageMetrics, verifyFrozenDensityPixelBody } = await import("./density-current-pixels.mjs");
  verifyFrozenDensityPixelBody(root, input.contract.capture.artifacts.measurementHarness.sha256);
  const seenDirectories = new Set<string>(), parts: DensitySegmentOriginals[] = [];
  for (const directory of input.directories) {
    assert(path.isAbsolute(directory) && fs.realpathSync(directory) === directory && directory !== root && !directory.startsWith(root + path.sep)
      && !seenDirectories.has(directory)); seenDirectories.add(directory);
    const stat = fs.lstatSync(directory); assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid!() && (stat.mode & 0o7777) === 0o700);
    const resultFile = stableBytes(path.join(directory, "actual-capture-result.json")), censusFile = stableBytes(path.join(directory, "current-census.json"));
    const result = record(json(resultFile.bytes)), selection = selectionSchema.parse(result.selection);
    assert(record(result.captureEnvironment).fontManifestSha256 === fontHash);
    const stem = `${sha256(densityStateKey(selection.routeId, selection.state))}__${selection.viewport}`;
    equal(fs.readdirSync(directory).sort(), ["actual-capture-result.json", "current-census.json", `${stem}.json`, `${stem}.png`].sort());
    const originalFile = stableBytes(path.join(directory, `${stem}.json`)), screenshot = stableBytes(path.join(directory, `${stem}.png`));
    const original = record(json(originalFile.bytes)), raw = record(original.rawMeasurement);
    assert(Array.isArray(result.fixtureCatalog));
    for (const item of result.fixtureCatalog) { const fixture = record(item);
      assert(typeof fixture.sourcePath === "string" && /^(?:scripts|e2e)\/[a-zA-Z0-9_./-]+\.(?:ts|mts|tsx)$/.test(fixture.sourcePath)
        && !fixture.sourcePath.split("/").some(part => part === "." || part === ".."));
      assert(publicBytes(path.join(root, fixture.sourcePath)).pin.sha256 === fixture.sourceSha256);
    }
    const viewport = DENSITY_VIEWPORTS.find(x => x.id === selection.viewport)!;
    const pixel = await imageMetrics(screenshot.pin.path, viewport.width, viewport.height, raw.pixelExclusionRects);
    equal(stableBytes(screenshot.pin.path).pin, screenshot.pin);
    for (const file of [resultFile, censusFile, originalFile]) equal(stableBytes(file.pin.path).pin, file.pin);
    pins.push(resultFile.pin, censusFile.pin, originalFile.pin, screenshot.pin);
    parts.push({ result, census: json(censusFile.bytes), original, screenshotSha256: screenshot.pin.sha256, recomputedPixel: pixel });
    for (const file of sourcePins.keys()) publicBytes(file);
    equal(densitySourceSchema.parse(data(await input.observeSource())), currentSource);
  }
  const union = validateDensitySegmentUnion({ ...input, source: currentSource, segments: parts });
  for (const file of sourcePins.keys()) publicBytes(file);
  equal(densitySourceSchema.parse(data(await input.observeSource())), currentSource);
  return { ...union, originalFilePins: pins, currentPublicSourcePins: [...sourcePins.values()] };
}
