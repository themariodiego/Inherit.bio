import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DensityStateSession } from "../e2e/helpers/density-current-capture";
import type { DensityContract, DensityCurrentPacket } from "./density-current";
import { densityRouteMatches, DENSITY_VIEWPORTS, type DensitySource, type DensityStateCase } from "./density-capture-plan";

const baselineCommit = "864736979c92a08ba77e8580d61946eba6864918";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.object({ head: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
const environment = z.object({ browserName: z.literal("chromium"), browserVersion: z.string().min(1),
  platform: z.string().min(1), fontManifestSha256: digest, theme: z.literal("light"), devicePixelRatio: z.literal(1),
  locale: z.literal("en-US"), timezone: z.literal("UTC") }).strict();
const relative = z.string().regex(/^[a-zA-Z0-9_-]+(?:[./][a-zA-Z0-9_-]+)*$/).refine(value =>
  !value.split("/").some(part => part === "." || part === "..") && !path.isAbsolute(value));
const pin = z.object({ path: relative, bytes: z.number().int().positive().max(16 * 1024 * 1024), sha256: digest }).strict();
export const densityBaselineOriginalsInputSchema = z.object({
  directory: z.string().refine(value => path.isAbsolute(value) && path.resolve(value) === value),
  packetBytes: z.number().int().positive().max(1024 * 1024), packetSha256: digest,
}).strict();
export type DensityBaselineOriginalsInput = z.infer<typeof densityBaselineOriginalsInputSchema>;
const packetSchema = z.object({ version: z.literal(1), baselineSource: identity,
  currentSource: identity, captureEnvironment: environment,
  environmentOriginal: pin, fontEnvironment: pin, baselineSourceOriginal: pin,
  baselineBuildOriginal: pin, currentBuildOriginal: pin, fontProvenanceOriginal: pin, captureManifest: pin,
  captures: z.array(z.object({ baselineRoute: z.string().startsWith("/"), state: z.string().min(1),
    measurementPath: z.string().startsWith("/").refine(value => !/[?#\\%\[\]]/.test(value) && !value.includes("//")),
    viewport: z.enum(["390x844", "1280x800"]), screenshot: pin }).strict()).min(1),
}).strict();
const faceSchema = z.object({ family: z.string().min(1), cssFamily: z.string().min(1),
  descriptors: z.record(z.string().regex(/^(?:font-(?:style|weight|stretch|display|feature-settings|variation-settings|named-instance|language-override)|unicode-range|ascent-override|descent-override|line-gap-override|size-adjust)$/),
    z.string().min(1).max(2048)),
  assetUrl: z.string().regex(/^\/_next\/static\/media\/[a-zA-Z0-9_.-]+$/),
  // This is separately pinned build provenance, never the compared environment.
  cssPublicUrl: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.href === value && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
        && !url.username && !url.password && !/[?#\\%]/.test(value)
        && /^\/_next\/static\/(?:css|chunks)\/[a-zA-Z0-9_.\/-]+\.css$/.test(url.pathname)
        && !url.pathname.split("/").some(part => part === "." || part === "..");
    } catch { return false; }
  }), css: pin, font: pin }).strict();
const fontSide = z.object({ source: identity, buildId: z.string().min(1).max(256), faces: z.array(faceSchema).min(1) }).strict();
const fontsSchema = z.object({ version: z.literal(1), baseline: fontSide, current: fontSide }).strict();
type Pin = z.infer<typeof pin>;
type Predecessor = DensityCurrentPacket["captures"][number]["predecessor"];
const equalEnvironment = (a: DensityCurrentPacket["captureEnvironment"], b: DensityCurrentPacket["captureEnvironment"]) =>
  (Object.keys(a) as (keyof typeof a)[]).every(key => a[key] === b[key]);

/** Mirrors only the unchanged verifier's existing comparable-state rule. */
export function comparableDensityBaseline(row: DensityStateCase, contract: DensityContract) {
  const predecessor = contract.relativeComparison.routes.find(entry => entry.successorRouteId === row.route.id);
  const baseline = contract.routes.find(entry => entry.route === predecessor?.baselineRoute);
  const initialAuthForm = row.route.stateProfile === "auth-density-flow" && row.state === "initial-form"
    && row.route.auth === "public" && ["auth.sign-in", "auth.sign-up", "auth.forgot-password", "auth.reset-password"].includes(row.route.id)
    && row.route.path === `/auth/${row.route.id.slice("auth.".length)}`;
  return predecessor && baseline && (baseline.state === row.state || (initialAuthForm && baseline.state === "empty"))
    && !["/ancestry", "/reports", "/dashboard"].includes(predecessor.baselineRoute) ? baseline : null;
}

/** Reads only Root-pinned PUBLIC originals. This supplies no runtime authority
 * and cannot relabel an old browser, substitute a ratio, or repin the baseline. */
export function readPinnedDensityBaselineOriginals(raw: DensityBaselineOriginalsInput, expected: {
  root: string; source: DensitySource; captureEnvironment: DensityCurrentPacket["captureEnvironment"]; contract: DensityContract;
}) {
  try {
    const input = densityBaselineOriginalsInputSchema.parse(raw), directory = input.directory;
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    assert(fs.realpathSync(directory) === directory && directoryStat.isDirectory()
      && directoryStat.uid === BigInt(process.getuid!()) && (directoryStat.mode & BigInt(0o777)) === BigInt(0o700));
    assert(directory !== fs.realpathSync(expected.root) && !directory.startsWith(`${fs.realpathSync(expected.root)}${path.sep}`));
    const directoryUnchanged = () => {
      const current = fs.lstatSync(directory, { bigint: true });
      assert(fs.realpathSync(directory) === directory && current.isDirectory()
        && current.dev === directoryStat.dev && current.ino === directoryStat.ino && current.uid === directoryStat.uid
        && current.gid === directoryStat.gid && current.mode === directoryStat.mode);
    };
    const read = (record: Pin) => {
      directoryUnchanged();
      const file = path.join(directory, record.path);
      assert(fs.realpathSync(file) === file && file.startsWith(`${directory}${path.sep}`));
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const a = fs.fstatSync(fd, { bigint: true });
        assert(a.isFile() && a.nlink === BigInt(1) && a.uid === BigInt(process.getuid!())
          && (a.mode & BigInt(0o777)) === BigInt(0o600) && a.size === BigInt(record.bytes));
        const bytes = fs.readFileSync(fd), b = fs.fstatSync(fd, { bigint: true });
        assert(BigInt(bytes.length) === a.size && sha256(bytes) === record.sha256
          && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs);
        directoryUnchanged(); return bytes;
      } finally { fs.closeSync(fd); }
    };
    const json = (record: Pin): unknown => JSON.parse(read(record).toString("utf8"));
    const packetPin = { path: "baseline-originals.json", bytes: input.packetBytes, sha256: input.packetSha256 };
    const packet = packetSchema.parse(json(packetPin));
    assert(expected.contract.baseline.commitSha === baselineCommit && packet.baselineSource.head === baselineCommit);
    assert.deepEqual(packet.currentSource, { head: expected.source.head, tree: expected.source.tree });
    assert(equalEnvironment(packet.captureEnvironment, environment.parse(expected.captureEnvironment)));
    const actualEnvironment = z.object({ captureEnvironment: environment }).passthrough().parse(json(packet.environmentOriginal));
    assert(equalEnvironment(actualEnvironment.captureEnvironment, packet.captureEnvironment));
    assert(packet.fontEnvironment.sha256 === packet.captureEnvironment.fontManifestSha256); read(packet.fontEnvironment);
    const sourceOriginal = z.object({ source: identity }).passthrough().parse(json(packet.baselineSourceOriginal));
    assert.deepEqual(sourceOriginal.source, packet.baselineSource);
    const buildSchema = z.object({ head: z.string(), buildId: z.string().min(1).max(256), nodeMajor: z.literal("22") }).passthrough();
    const baselineBuild = buildSchema.parse(json(packet.baselineBuildOriginal));
    const currentBuild = buildSchema.parse(json(packet.currentBuildOriginal));
    assert(baselineBuild.head === baselineCommit && currentBuild.head === expected.source.head);
    const fonts = fontsSchema.parse(json(packet.fontProvenanceOriginal));
    assert.deepEqual(fonts.baseline.source, packet.baselineSource); assert.deepEqual(fonts.current.source, packet.currentSource);
    assert(fonts.baseline.buildId === baselineBuild.buildId && fonts.current.buildId === currentBuild.buildId);
    const canonicalDescriptors = (descriptors: Record<string, string>) => Object.fromEntries(Object.entries({
      "font-style": "normal", "font-weight": "normal", "font-stretch": "normal", "font-display": "auto",
      "unicode-range": "U+0-10FFFF", ...descriptors }).sort(([a], [b]) => a.localeCompare(b)));
    const faceKey = (face: z.infer<typeof faceSchema>) => JSON.stringify([face.family, canonicalDescriptors(face.descriptors)]);
    for (const side of [fonts.baseline, fonts.current]) {
      assert(new Set(side.faces.map(faceKey)).size === side.faces.length);
      for (const face of side.faces) {
        assert(path.basename(face.font.path) === path.basename(face.assetUrl));
        read(face.font); const css = read(face.css).toString("utf8");
        const matching = [...css.matchAll(/@font-face\s*\{([^{}]*)\}/g)].some(match => {
          const declarations = Object.fromEntries(match[1].split(";").filter(Boolean).map(entry => {
            const colon = entry.indexOf(":"); return [entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()];
          }));
          const family = (declarations["font-family"] ?? "").replace(/^(['"])(.*)\1$/, "$2");
          const urls = [...(declarations.src ?? "").matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/g)].map(value => value[2]);
          const descriptors = Object.fromEntries(Object.entries(declarations).filter(([key]) => key !== "font-family" && key !== "src"));
          if (family !== face.cssFamily
            || JSON.stringify(canonicalDescriptors(descriptors)) !== JSON.stringify(canonicalDescriptors(face.descriptors))) return false;
          const cssPublicUrl = new URL(face.cssPublicUrl);
          // Resolve the unchanged CSS literal. Next may emit ../media/hash.p.woff2.
          // Every selected source must identify the same actual pinned font bytes.
          return urls.length > 0 && urls.every(value => {
            if (value.length > 2048 || /[\\?#%\s]/.test(value)) return false;
            try {
              const resolved = new URL(value, cssPublicUrl);
              return resolved.origin === cssPublicUrl.origin && !resolved.username && !resolved.password
                && !resolved.search && !resolved.hash && resolved.pathname === face.assetUrl;
            } catch { return false; }
          });
        });
        assert(matching, "Actual whole CSS to font asset correspondence required");
      }
    }
    // Every baseline face must have the same effective descriptors and bytes.
    // A new current-only face remains full provenance, outside environment ID.
    for (const before of fonts.baseline.faces) {
      const after = fonts.current.faces.find(face => faceKey(face) === faceKey(before));
      assert(after && after.font.sha256 === before.font.sha256 && after.font.bytes === before.font.bytes);
    }
    const manifest = z.object({ schemaVersion: z.literal(1), captureEnvironment: z.object({
      origin: z.string().url(), browserName: z.string(), browserVersion: z.string(), locale: z.literal("en-US"),
      timezone: z.literal("UTC"), theme: z.literal("light"), devicePixelRatio: z.literal(1),
      serviceWorkers: z.literal("blocked") }).passthrough(), routes: z.record(z.string(), z.unknown()) }).strict().parse(json(packet.captureManifest));
    const origin = new URL(manifest.captureEnvironment.origin);
    assert(origin.origin === manifest.captureEnvironment.origin && origin.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(origin.hostname) && !origin.username && !origin.password);
    // Legacy browserName is retained byte-exact, never rewritten or trusted.
    // Actual version must still match both observed environment and manifest.
    assert(manifest.captureEnvironment.browserVersion === packet.captureEnvironment.browserVersion);
    assert(expected.contract.baseline.routeCount === expected.contract.routes.length
      && expected.contract.baseline.captureCount === expected.contract.routes.length * DENSITY_VIEWPORTS.length);
    const keys = packet.captures.map(row => JSON.stringify([row.baselineRoute, row.state, row.viewport]));
    const required = expected.contract.routes.flatMap(row => DENSITY_VIEWPORTS.map(viewport => JSON.stringify([row.route, row.state, viewport.id])));
    assert(keys.length === required.length && new Set(keys).size === keys.length && required.every(key => keys.includes(key)));
    for (const capture of packet.captures) {
      const original = z.object({ measurementPath: z.string() }).passthrough().parse(
        expected.contract.routes.find(row => row.route === capture.baselineRoute && row.state === capture.state));
      assert(capture.measurementPath === original.measurementPath);
    }
    assert.deepEqual(Object.keys(manifest.routes).sort(), [...new Set(packet.captures.map(row => row.measurementPath))].sort());
    packet.captures.forEach(capture => read(capture.screenshot));
    const metadata = [packetPin, packet.environmentOriginal, packet.fontEnvironment, packet.baselineSourceOriginal,
      packet.baselineBuildOriginal, packet.currentBuildOriginal, packet.fontProvenanceOriginal, packet.captureManifest,
      ...[fonts.baseline, fonts.current].flatMap(side => side.faces.flatMap(face => [face.css, face.font]))];
    return {
      async predecessor(row: DensityStateCase, viewportId: string, actualBuildId: string): Promise<Predecessor> {
        try {
          metadata.forEach(read);
          assert(actualBuildId === currentBuild.buildId);
          const baseline = comparableDensityBaseline(row, expected.contract); if (!baseline) return null;
          const viewport = DENSITY_VIEWPORTS.find(value => value.id === viewportId); assert(viewport);
          const capture = packet.captures.find(value => value.baselineRoute === baseline.route
            && value.state === baseline.state && value.viewport === viewport.id); assert(capture);
          assert(densityRouteMatches(baseline.route, capture.measurementPath, origin.origin));
          const observations = z.record(z.string(), z.unknown()).parse(manifest.routes[capture.measurementPath]);
          const rawMeasurement = z.object({ screenshotFile: z.string(), resolvedUrl: z.string().url(),
            ground: z.literal("rgb(247, 248, 241)"), dpr: z.literal(1), innerWidth: z.number(), innerHeight: z.number(),
            horizontalScroll: z.literal(false), horizontalOverflowPx: z.literal(0),
            pixelExclusionRects: z.array(z.object({ left: z.number().finite(), top: z.number().finite(),
              right: z.number().finite(), bottom: z.number().finite() }).passthrough()) }).passthrough().parse(observations[viewport.id]);
          assert(rawMeasurement.innerWidth === viewport.width && rawMeasurement.innerHeight === viewport.height
            && rawMeasurement.screenshotFile === path.basename(capture.screenshot.path)
            && rawMeasurement.resolvedUrl === `${origin.origin}${capture.measurementPath}`);
          read(capture.screenshot);
          const { imageMetrics, verifyFrozenDensityPixelBody } = await import("./density-current-pixels.mjs");
          verifyFrozenDensityPixelBody(expected.root, expected.contract.capture.artifacts.measurementHarness.sha256);
          const metrics = await imageMetrics(path.join(directory, capture.screenshot.path), viewport.width, viewport.height,
            rawMeasurement.pixelExclusionRects);
          assert(metrics.screenshotSha256 === capture.screenshot.sha256); read(capture.screenshot); metadata.forEach(read);
          return { baselineCommit, baselineRoute: baseline.route, state: baseline.state,
            captureEnvironment: { ...packet.captureEnvironment }, screenshotSha256: metrics.screenshotSha256,
            inkCoverageRatio: metrics.inkCoverageRatio };
        } catch { throw new Error("Pinned genuine baseline predecessor refused"); }
      },
    };
  } catch { throw new Error("Pinned genuine baseline originals refused"); }
}

/** Connects the existing optional callback without touching native observation. */
export function connectDensityPredecessor(session: DensityStateSession, row: DensityStateCase, actualBuildId: string,
  originals?: ReturnType<typeof readPinnedDensityBaselineOriginals>): DensityStateSession {
  if (!originals) return session; // Missing evidence retains the existing HOLD.
  assert(session.predecessor === undefined, "Two predecessor producers cannot replace one another");
  return { page: session.page, observe: session.observe,
    predecessor: viewport => originals.predecessor(row, viewport, actualBuildId) };
}
