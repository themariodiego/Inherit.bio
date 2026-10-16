// Pure invented file controls; these are not captures or runtime evidence.
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { comparableDensityBaseline, connectDensityPredecessor, readPinnedDensityBaselineOriginals } from "./density-baseline-originals";
import type { DensityContract, DensityCurrentPacket } from "./density-current";
import { DENSITY_VIEWPORTS, type DensityStateCase } from "./density-capture-plan";
import type { DensityStateSession } from "../e2e/helpers/density-current-capture";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frozen = JSON.parse(fs.readFileSync(path.join(root, "docs/density-baseline.json"), "utf8")) as DensityContract;
const baselineCommit = "864736979c92a08ba77e8580d61946eba6864918";
const currentSource = { head: "1".repeat(40), tree: "2".repeat(40), registerSha256: "3".repeat(64) };
const baselineSource = { head: baselineCommit, tree: "4".repeat(40) };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const row: DensityStateCase = { route: { id: "about", path: "/about", kind: "page", surface: "marketing" }, state: "complete" };
const baselineRoute = { route: "/about", state: "complete", measurementPath: "/about" };
const contract: DensityContract = { baseline: { commitSha: baselineCommit, routeCount: 1, captureCount: 2 },
  capture: frozen.capture, routes: [baselineRoute],
  relativeComparison: { routes: [{ baselineRoute: "/about", successorRouteId: "about" }] } };

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width: number, height: number) {
  const chunk = (name: string, bytes: Buffer) => {
    const header = Buffer.alloc(4), checksum = Buffer.alloc(4), type = Buffer.from(name);
    header.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([header, type, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  // Black RGB pixels, each scanline uses the genuine PNG "none" filter.
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function inventedOriginals() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "density-predecessor-unit-")));
  const write = (name: string, bytes: Buffer | string) => {
    const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, bytes, { mode: 0o600 }); const actual = fs.readFileSync(file);
    return { path: name, bytes: actual.length, sha256: hash(actual) };
  };
  const json = (name: string, value: unknown) => write(name, JSON.stringify(value));
  const fontEnvironment = write("font-environment.json", '{"unitOnly":true,"platform":"synthetic"}');
  const environment: DensityCurrentPacket["captureEnvironment"] = { browserName: "chromium", browserVersion: "unit-only-151.34",
    platform: "unit-only-linux-arm64", fontManifestSha256: fontEnvironment.sha256, theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC" };
  const font = write("fonts/common.woff2", "invented-unit-font-bytes");
  const face = (name: string, cssFamily: string) => ({ family: "Inter", cssFamily, descriptors: { "font-style": "normal", "font-weight": "100 900" },
    assetUrl: "/_next/static/media/common.woff2", font,
    cssPublicUrl: `http://localhost:3400/_next/static/css/${name}`,
    css: write(name, `@font-face{font-family:${cssFamily};font-style:normal;font-weight:100 900;src:url(/_next/static/media/common.woff2) format('woff2')}`) });
  const fonts = { version: 1, baseline: { source: baselineSource, buildId: "unit-baseline-build", faces: [face("baseline.css", "__old_Inter")] },
    current: { source: { head: currentSource.head, tree: currentSource.tree }, buildId: "unit-current-build", faces: [face("current.css", "__new_Inter")] } };
  const routes = { "/about": Object.fromEntries(DENSITY_VIEWPORTS.map(viewport => [viewport.id, {
    screenshotFile: `about__${viewport.id}.png`, resolvedUrl: "http://localhost:3400/about", ground: "rgb(247, 248, 241)",
    dpr: 1, innerWidth: viewport.width, innerHeight: viewport.height, horizontalScroll: false, horizontalOverflowPx: 0, pixelExclusionRects: [],
  }])) };
  const manifest = { schemaVersion: 1, captureEnvironment: { origin: "http://localhost:3400", browserName: "Google Chrome",
    browserVersion: environment.browserVersion, nodeVersion: "22.unit", locale: "en-US", timezone: "UTC", theme: "light", devicePixelRatio: 1,
    serviceWorkers: "blocked" }, routes };
  const packet = { version: 1, baselineSource, currentSource: { head: currentSource.head, tree: currentSource.tree }, captureEnvironment: environment,
    environmentOriginal: json("environment-original.json", { captureEnvironment: environment, unitOnly: true }), fontEnvironment,
    baselineSourceOriginal: json("baseline-source-original.json", { source: baselineSource, unitOnly: true }),
    baselineBuildOriginal: json("baseline-build-original.json", { head: baselineCommit, buildId: fonts.baseline.buildId, nodeMajor: "22" }),
    currentBuildOriginal: json("current-build-original.json", { head: currentSource.head, buildId: fonts.current.buildId, nodeMajor: "22" }),
    fontProvenanceOriginal: json("font-provenance-original.json", fonts), captureManifest: json("capture-manifest.json", manifest),
    captures: DENSITY_VIEWPORTS.map(viewport => ({ baselineRoute: "/about", state: "complete", measurementPath: "/about", viewport: viewport.id,
      screenshot: write(`screenshots/about__${viewport.id}.png`, png(viewport.width, viewport.height)) })) };
  const savePacket = () => { const saved = json("baseline-originals.json", packet); return { directory, packetBytes: saved.bytes, packetSha256: saved.sha256 }; };
  const load = () => readPinnedDensityBaselineOriginals(savePacket(), { root, source: currentSource, captureEnvironment: environment, contract });
  return { directory, packet, fonts, manifest, environment, write, json, load, savePacket,
    close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
async function withOriginals(work: (fixture: ReturnType<typeof inventedOriginals>) => Promise<void> | void) {
  const fixture = inventedOriginals(); try { await work(fixture); } finally { fixture.close(); }
}

describe("genuine pinned density predecessor callback connection", () => {
  it("recomputes both real PNG byte fixtures through the unchanged frozen pixel body", async () => withOriginals(async fixture => {
    const loaded = fixture.load();
    for (const viewport of DENSITY_VIEWPORTS) {
      const before = await loaded.predecessor(row, viewport.id, "unit-current-build");
      expect(before).toEqual({ baselineCommit, baselineRoute: "/about", state: "complete", captureEnvironment: fixture.environment,
        screenshotSha256: fixture.packet.captures.find(capture => capture.viewport === viewport.id)!.screenshot.sha256, inkCoverageRatio: 1 });
    }
  }));
  it("keeps absent Root input as the original missing callback, never a fabricated predecessor", () => {
    const session = { page: {}, observe: vi.fn() } as unknown as DensityStateSession;
    expect(connectDensityPredecessor(session, row, "unit-current-build")).toBe(session);
    expect(session.predecessor).toBeUndefined();
  });
  it("preserves the exact native observer/page and forwards the existing callback inputs", async () => {
    const session = { page: {}, observe: vi.fn() } as unknown as DensityStateSession;
    const predecessor = vi.fn(async () => null);
    const connected = connectDensityPredecessor(session, row, "unit-current-build", { predecessor });
    expect(connected.page).toBe(session.page); expect(connected.observe).toBe(session.observe);
    expect(await connected.predecessor!("390x844")).toBeNull();
    expect(predecessor).toHaveBeenCalledExactlyOnceWith(row, "390x844", "unit-current-build");
    expect(session.observe).not.toHaveBeenCalled();
  });
  it("refuses two producers rather than replacing an existing provider callback", () => {
    const session = { page: {}, observe: vi.fn(), predecessor: vi.fn() } as unknown as DensityStateSession;
    expect(() => connectDensityPredecessor(session, row, "unit-current-build", { predecessor: async () => null })).toThrow();
  });
  it("refuses a supplied ratio rather than using it instead of actual PNG recomputation", async () => withOriginals(fixture => {
    Object.assign(fixture.packet, { inkCoverageRatio: 0.000001 });
    expect(() => fixture.load()).toThrow("Pinned genuine baseline originals refused");
  }));
  it("retains current-only added font faces separately from the compared environment", async () => withOriginals(async fixture => {
    const added = { ...fixture.fonts.current.faces[0], family: "Unit italic face", cssFamily: "__new_Italic", descriptors: { "font-style": "italic", "font-weight": "100 900" },
      font: fixture.write("fonts/italic.woff2", "invented-unit-italic-font"), assetUrl: "/_next/static/media/italic.woff2",
      cssPublicUrl: "http://localhost:3400/_next/static/css/italic.css",
      css: fixture.write("italic.css", "@font-face{font-family:__new_Italic;font-style:italic;font-weight:100 900;src:url(/_next/static/media/italic.woff2)}") };
    fixture.fonts.current.faces.push(added); fixture.packet.fontProvenanceOriginal = fixture.json("font-provenance-original.json", fixture.fonts);
    const originalIdentity = fixture.environment.fontManifestSha256;
    expect(await fixture.load().predecessor(row, "390x844", "unit-current-build")).not.toBeNull();
    expect(fixture.environment.fontManifestSha256).toBe(originalIdentity);
  }));

  it("resolves the original relative Next font URL against its actual pinned CSS public URL", async () => withOriginals(async fixture => {
    for (const side of [fixture.fonts.baseline, fixture.fonts.current]) {
      const face = side.faces[0];
      face.css = fixture.write(face.css.path, `@font-face{font-family:${face.cssFamily};font-style:normal;font-weight:100 900;src:url('../media/common.woff2') format('woff2')}`);
    }
    fixture.packet.fontProvenanceOriginal = fixture.json("font-provenance-original.json", fixture.fonts);
    expect(await fixture.load().predecessor(row, "390x844", "unit-current-build")).not.toBeNull();
  }));
  it.each(["other-origin", "other-path", "query", "fragment", "mixed-other-origin", "missing-css-public-url", "external-css-public-url"])("refuses %s CSS/font correspondence", async kind => withOriginals(fixture => {
    const face = fixture.fonts.current.faces[0];
    const source = kind === "other-origin" ? "http://foreign.invalid/_next/static/media/common.woff2"
      : kind === "other-path" ? "../media/other.woff2" : kind === "query" ? "../media/common.woff2?x=1"
      : kind === "fragment" ? "../media/common.woff2#fragment" : "../media/common.woff2";
    const second = kind === "mixed-other-origin" ? ", url(http://foreign.invalid/_next/static/media/common.woff2)" : "";
    face.css = fixture.write(face.css.path, `@font-face{font-family:${face.cssFamily};font-style:normal;font-weight:100 900;src:url(${source})${second}}`);
    if (kind === "missing-css-public-url") Reflect.deleteProperty(face, "cssPublicUrl");
    if (kind === "external-css-public-url") face.cssPublicUrl = "http://foreign.invalid/_next/static/css/current.css";
    fixture.packet.fontProvenanceOriginal = fixture.json("font-provenance-original.json", fixture.fonts);
    expect(() => fixture.load()).toThrow("Pinned genuine baseline originals refused");
  }));
  it.each(["baseline", "current", "browser-name", "browser-version", "platform", "manifest-old-version", "source-original", "build-source",
    "font-bytes", "font-descriptor", "css-url", "font-environment", "missing-capture", "duplicate-capture"])("refuses pinned %s inconsistency", async kind => withOriginals(fixture => {
    if (kind === "baseline") fixture.packet.baselineSource = { ...baselineSource, head: "9".repeat(40) };
    if (kind === "current") fixture.packet.currentSource = { ...fixture.packet.currentSource, tree: "9".repeat(40) };
    if (kind === "browser-name") Object.assign(fixture.packet.captureEnvironment, { browserName: "Google Chrome" });
    if (kind === "browser-version") fixture.packet.captureEnvironment.browserVersion = "old-Chrome-151.175";
    if (kind === "platform") fixture.packet.captureEnvironment.platform = "old-macos";
    if (kind === "manifest-old-version") {
      fixture.manifest.captureEnvironment.browserVersion = "old-Chrome-151.175";
      fixture.packet.captureManifest = fixture.json("capture-manifest.json", fixture.manifest);
    }
    if (kind === "source-original") fixture.packet.baselineSourceOriginal = fixture.json("baseline-source-original.json", { source: { ...baselineSource, tree: "9".repeat(40) } });
    if (kind === "build-source") fixture.packet.currentBuildOriginal = fixture.json("current-build-original.json", { head: "9".repeat(40), buildId: "unit-current-build", nodeMajor: "22" });
    if (kind === "font-bytes") fixture.fonts.current.faces[0].font = fixture.write("new/common.woff2", "changed-unit-font");
    if (kind === "font-descriptor") fixture.fonts.current.faces[0].descriptors["font-weight"] = "400";
    if (kind === "css-url") fixture.fonts.current.faces[0].assetUrl = "/_next/static/media/missing.woff2";
    if (kind.startsWith("font-") || kind === "css-url") fixture.packet.fontProvenanceOriginal = fixture.json("font-provenance-original.json", fixture.fonts);
    if (kind === "font-environment") fixture.packet.fontEnvironment = fixture.write("other-environment.json", "changed-unit-platform");
    if (kind === "missing-capture") fixture.packet.captures.pop();
    if (kind === "duplicate-capture") fixture.packet.captures[1] = fixture.packet.captures[0];
    expect(() => fixture.load()).toThrow("Pinned genuine baseline originals refused");
  }));
  it.each(["build", "viewport", "dimensions", "DPR", "navigation", "PNG", "changed-metadata", "changed-screenshot"])("refuses %s at the callback bookend", async kind => withOriginals(async fixture => {
    if (kind === "dimensions" || kind === "DPR" || kind === "navigation") {
      const raw = fixture.manifest.routes["/about"]["390x844"] as { innerWidth: number; dpr: number; resolvedUrl: string };
      if (kind === "dimensions") raw.innerWidth = 391;
      if (kind === "DPR") raw.dpr = 2;
      if (kind === "navigation") raw.resolvedUrl = "http://localhost:3400/foreign";
      fixture.packet.captureManifest = fixture.json("capture-manifest.json", fixture.manifest);
    }
    if (kind === "PNG") fixture.packet.captures[0].screenshot = fixture.write("screenshots/about__390x844.png", png(1, 1));
    const loaded = fixture.load();
    if (kind === "changed-metadata") fixture.write("environment-original.json", "{}");
    if (kind === "changed-screenshot") fixture.write("screenshots/about__390x844.png", "changed-original");
    await expect(loaded.predecessor(row, kind === "viewport" ? "320x844" : "390x844",
      kind === "build" ? "other-actual-build" : "unit-current-build")).rejects.toThrow("Pinned genuine baseline predecessor refused");
  }));
  it.each(["symlink", "hardlink", "mode", "traversal", "packet-pin"])("refuses %s artifact custody", async kind => withOriginals(fixture => {
    const target = path.join(fixture.directory, "environment-original.json");
    if (kind === "symlink") { fs.renameSync(target, `${target}.saved`); fs.symlinkSync(`${target}.saved`, target); }
    if (kind === "hardlink") fs.linkSync(target, `${target}.linked`);
    if (kind === "mode") fs.chmodSync(target, 0o644);
    if (kind === "traversal") fixture.packet.environmentOriginal.path = "../outside.json";
    const input = fixture.savePacket(); if (kind === "packet-pin") input.packetSha256 = "0".repeat(64);
    expect(() => readPinnedDensityBaselineOriginals(input, { root, source: currentSource, captureEnvironment: fixture.environment, contract })).toThrow();
  }));
  it("does not fabricate predecessors for new, processing or waived invented-result states", async () => withOriginals(async fixture => {
    const loaded = fixture.load();
    expect(await loaded.predecessor({ ...row, state: "processing" }, "390x844", "unit-current-build")).toBeNull();
    expect(await loaded.predecessor({ ...row, route: { ...row.route, id: "new-page" } }, "390x844", "unit-current-build")).toBeNull();
    for (const route of ["/ancestry", "/reports", "/dashboard"]) {
      const held = { ...contract, routes: [{ route, state: "complete" }], relativeComparison: { routes: [{ baselineRoute: route, successorRouteId: row.route.id }] } };
      expect(comparableDensityBaseline(row, held)).toBeNull();
    }
  }));
  it.each(["sign-in", "sign-up", "forgot-password", "reset-password"])("connects only actual %s initial-form to the frozen empty state", name => {
    const authRow: DensityStateCase = { route: { id: `auth.${name}`, path: `/auth/${name}`, kind: "page", surface: "flow",
      auth: "public", stateProfile: "auth-density-flow" }, state: "initial-form" };
    const authContract = { ...contract, routes: [{ route: `/auth/${name}`, state: "empty" }],
      relativeComparison: { routes: [{ baselineRoute: `/auth/${name}`, successorRouteId: `auth.${name}` }] } };
    expect(comparableDensityBaseline(authRow, authContract)).toEqual(authContract.routes[0]);
    expect(comparableDensityBaseline({ ...authRow, state: "processing" }, authContract)).toBeNull();
    expect(comparableDensityBaseline({ ...authRow, route: { ...authRow.route, path: "/foreign" } }, authContract)).toBeNull();
  });
});
