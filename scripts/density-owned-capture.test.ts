import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { densityNativeRuntimeHook, sameDensityFixture } from "./density-owned-capture";
import { sequentialDensityCleanup, type FreshDensityRuntime } from "./density-fresh-runtime";
import type { DensityStateFixture } from "../e2e/helpers/density-current-capture";
import type { DensityStateCase } from "./density-capture-plan";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
const row = { route: { id: "embryos.detail" }, state: "empty" } as DensityStateCase;
const viewport = { id: "390x844", width: 390, height: 844 } as const;
const lease = () => ({ environment: { selected: "actual-owned-fixture" } }) as unknown as FreshDensityRuntime;
const fixture = (): DensityStateFixture => ({ routeId: row.route.id, state: row.state, serviceOrigin: "http://localhost:3105",
  sourcePath: "e2e/helpers/density-finalized-embryo-empty-state-fixtures.ts", sourceSha256: "a".repeat(64),
  withState: async () => {} });

describe("once-owned fresh density fixture wiring", () => {
  it("delegates the exact original native callback into its retained actual environment", async () => {
    const owned = lease(), work = vi.fn(async environment => environment);
    const hook = densityNativeRuntimeHook(owned, { row, viewport }, () => true);
    expect(await hook.withFreshNativeRuntime(row, viewport, work)).toBe(owned.environment);
    expect(work).toHaveBeenCalledExactlyOnceWith(owned.environment, undefined); hook.assertCompleted();
    await expect(hook.withFreshNativeRuntime(row, viewport, work)).rejects.toThrow();
    expect(work).toHaveBeenCalledTimes(1);
  });
  it.each(["route", "state", "viewport", "closed"])("refuses %s mismatch before executing native work", async kind => {
    const work = vi.fn(), hook = densityNativeRuntimeHook(lease(), { row, viewport }, () => kind !== "closed");
    const changedRow = kind === "route" ? { ...row, route: { ...row.route, id: "other" } }
      : kind === "state" ? { ...row, state: "processing" } : row;
    const changedViewport = kind === "viewport" ? { id: "1280x800", width: 1280, height: 800 } as const : viewport;
    await expect(hook.withFreshNativeRuntime(changedRow, changedViewport, work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it("retains uncertainty when a callback catches its own failed native invocation", async () => {
    const hook = densityNativeRuntimeHook(lease(), { row, viewport }, () => true);
    await expect(hook.withFreshNativeRuntime(row, viewport, async () => { throw new Error("private source withheld"); })).rejects.toThrow();
    expect(() => hook.assertCompleted()).toThrow();
    await expect(hook.withFreshNativeRuntime(row, viewport, async () => "retry")).rejects.toThrow();
  });
  it("rejects ownership ending during an otherwise completed callback", async () => {
    let active = true;
    const hook = densityNativeRuntimeHook(lease(), { row, viewport }, () => active);
    await expect(hook.withFreshNativeRuntime(row, viewport, async () => { active = false; })).rejects.toThrow();
    expect(() => hook.assertCompleted()).toThrow();
  });
  it.each(["routeId", "state", "serviceOrigin", "sourcePath", "sourceSha256"] as const)("refuses fresh factory %s drift", key => {
    const expected = fixture(), actual = { ...expected, [key]: "changed" };
    expect(() => sameDensityFixture(expected, actual)).toThrow();
    expect(() => sameDensityFixture(expected, fixture())).not.toThrow();
  });
  it("awaits every physical closer in order and makes cleanup idempotent", async () => {
    const events: string[] = []; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const close = sequentialDensityCleanup([async () => { events.push("browser"); await held; events.push("closed"); },
      async () => { events.push("apps"); }, async () => { events.push("native"); }]);
    const first = close(); expect(close()).toBe(first); expect(events).toEqual(["browser"]);
    release(); await first; await close(); expect(events).toEqual(["browser", "closed", "apps", "native"]);
  });
  it("keeps cleanup refused and never releases a later resource after uncertain close", async () => {
    const later = vi.fn(); const close = sequentialDensityCleanup([async () => { throw new Error("uncertain close"); }, later]);
    const first = close(); await expect(first).rejects.toThrow("uncertain close");
    expect(close()).toBe(first); await expect(close()).rejects.toThrow(); expect(later).not.toHaveBeenCalled();
  });
  it("connects actual fresh stack, live runtime and separately spawned original services before original factories", () => {
    const source = read("scripts/density-fresh-runtime.ts"), controller = read("scripts/density-owned-capture.ts");
    for (const text of ["await acquireFreshStack(signal, io, operator)", "await startCiBrowserRuntime(infrastructure, true, operator)",
      "for (const port of APP_PORTS)", "apps.set(port, { child, appEnvironment: Object.freeze({ ...appEnvironment }) })",
      "APP_SERVICE_OBSERVATION_OPTION", "ownedLinuxChildProof(operator)", "await ready(app.child, port, signal)",
      "await chromium.launch", "await stack.close()", "runtime?.stop()"])
      expect(source).toContain(text);
    expect(source.indexOf("await acquireFreshStack")).toBeLessThan(source.indexOf("await startCiBrowserRuntime"));
    expect(source.indexOf("ownedDensityServiceObservers({ child:")).toBeLessThan(source.indexOf("await ready(app.child"));
    for (const text of ["first ?? await acquireFreshDensityRuntime", "!usedBrowsers.has(lease.browser)",
      "input.nativeObservers(lease)", "sameDensityFixture(expected, actual)", "await actual.withState(selection, capture)",
      "current.hook.assertCompleted()", "await lease.close()", "live.observers(origin, selectedFixture.sourcePath)"])
      expect(controller).toContain(text);
    expect(controller).not.toMatch(/new URL\(.*replace|\.observeRuntime\(\)|JSON\.parse\(process\.env/);
  });
  it("keeps the existing driver browser default and also verifies the actual live per-fixture Chromium", () => {
    const source = read("e2e/helpers/density-current-capture.ts");
    expect(source).toContain("page.context().browser() === options.browser");
    for (const text of ["const admittedBrowser = options.readOwnedBrowser?.()", "page.context().browser() === admittedBrowser",
      "admittedBrowser.isConnected()", 'admittedBrowser.browserType().name() === "chromium"', "admittedBrowser.version() === browserVersion",
      "const before = checkedDensityStateProof(await session.observe(), expected)", "const after = checkedDensityStateProof(await session.observe(), expected)"])
      expect(source).toContain(text);
  });
});
