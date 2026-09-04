import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIMARY_ROUTES,
  ROUTE_IDS,
  route,
  routePattern,
  type RouteId,
} from "./primary-routes";

// The register is the authority (docs/canonical-artifacts.md); this module
// is its runtime mirror. Every id here must exist there with the same path.

interface RegisterRoute {
  id: string;
  path: string;
}

const register = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8"),
) as { routes: RegisterRoute[] };
const registered = new Map(register.routes.map((entry) => [entry.id, entry]));

/** The `[name]` segments of a register pattern. */
function paramNames(pattern: string): string[] {
  return [...pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
}

const EXPECTED_IDS: readonly RouteId[] = [
  "app.overview",
  "genome.subject",
  "genome.reports",
  "genome.report",
  "genome.ancestry",
  "genome.data",
  "genome.browser",
  "family.index",
  "family.invite",
  "family.person",
  "family.permissions",
  "family.health-picture",
  "family.portrait",
  "embryos.index",
  "embryos.upload",
  "embryos.compare",
  "copilot.scope",
  "files.index",
  "files.upload",
  "settings.index",
  "settings.data",
  "settings.copilot",
  "settings.people",
  "settings.consents",
  "marketing.providers",
  "science.index",
  "legal.future-person",
  "legal.where-inherit-works",
];

describe("primary routes", () => {
  it("builds exactly the brief's route ids, each once", () => {
    expect([...ROUTE_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ROUTE_IDS).size).toBe(ROUTE_IDS.length);
    for (const id of ROUTE_IDS) expect(typeof PRIMARY_ROUTES[id]).toBe("function");
  });

  it("mirrors docs/route-register.json#routes for every id", () => {
    expect(register.routes.length).toBeGreaterThan(0);
    for (const id of ROUTE_IDS) {
      const entry = registered.get(id);
      if (!entry) {
        throw new Error(
          `primary-routes: "${id}" is not a route id in docs/route-register.json#routes`,
        );
      }
      expect(routePattern(id), id).toBe(entry.path);
    }
  });

  it("encodes every named param with encodeURIComponent", () => {
    const raw = "a b/c?d#e&f=g";
    const encoded = encodeURIComponent(raw);
    let withParams = 0;
    for (const id of ROUTE_IDS) {
      const pattern = routePattern(id);
      const names = paramNames(pattern);
      if (names.length === 0) {
        expect((PRIMARY_ROUTES[id] as () => string)()).toBe(pattern);
        continue;
      }
      withParams += 1;
      const params = Object.fromEntries(names.map((name) => [name, raw]));
      const href = (PRIMARY_ROUTES[id] as (p: Record<string, string>) => string)(params);
      expect(href, id).toBe(pattern.replace(/\[[^\]]+\]/g, encoded));
      expect(href, id).not.toContain(raw);
    }
    expect(withParams).toBeGreaterThan(0);
  });

  it("refuses a missing or empty segment rather than building a different route", () => {
    expect(() => route("genome.subject", { subject: "" })).toThrow(/subject/);
    expect(() =>
      (PRIMARY_ROUTES["genome.report"] as (p: Record<string, string>) => string)({ subject: "me" }),
    ).toThrow(/slug/);
  });

  it("renders query and hash after the path, encoded and in insertion order", () => {
    expect(route("files.upload", { query: { subject: "me" } })).toBe("/files/upload?subject=me");
    expect(route("files.upload", { query: { subject: "s-1/2 3" } })).toBe(
      "/files/upload?subject=s-1%2F2%203",
    );
    expect(route("files.upload", { query: { a: "1", b: "x y" } })).toBe("/files/upload?a=1&b=x%20y");
    expect(route("files.upload", { query: {} })).toBe("/files/upload");
    expect(route("files.upload", {})).toBe("/files/upload");
    expect(route("genome.reports", { subject: "me" }, { query: { layer: "variant_call" } })).toBe(
      "/genome/me/reports?layer=variant_call",
    );
    expect(route("genome.reports", { subject: "me" }, { hash: "cancer" })).toBe(
      "/genome/me/reports#cancer",
    );
    expect(route("science.index", { hash: "evidence" })).toBe("/science#evidence");
    expect(
      route(
        "genome.browser",
        { subject: "me" },
        { query: { q: "chr20:1000000-1100000" }, hash: "results" },
      ),
    ).toBe("/genome/me/data/browser?q=chr20%3A1000000-1100000#results");
  });

  it("renders the hrefs the E2E specs pin, byte for byte", () => {
    expect(route("app.overview")).toBe("/overview");
    expect(route("genome.subject", { subject: "me" })).toBe("/genome/me");
    expect(route("genome.reports", { subject: "me" })).toBe("/genome/me/reports");
    expect(route("genome.ancestry", { subject: "me" })).toBe("/genome/me/ancestry");
    expect(route("genome.data", { subject: "me" })).toBe("/genome/me/data");
    expect(
      route("genome.report", { subject: "me", slug: "apoe-e4-alzheimers-risk" }, { query: { reveal: "1" } }),
    ).toBe("/genome/me/reports/apoe-e4-alzheimers-risk?reveal=1");
    expect(
      route("copilot.scope", { scope: "me" }, { query: { report: "caffeine-metabolism-cyp1a2-rs762551" } }),
    ).toBe("/copilot/me?report=caffeine-metabolism-cyp1a2-rs762551");
    expect(route("copilot.scope", { scope: "me" })).toBe("/copilot/me");
    expect(route("files.upload", { query: { subject: "me" } })).toBe("/files/upload?subject=me");
    expect(route("files.index")).toBe("/files");
    expect(route("files.upload")).toBe("/files/upload");
    expect(route("family.index")).toBe("/family");
    expect(route("family.person", { person: "s-123" })).toBe("/family/s-123");
    expect(route("family.portrait", { pairId: "p-1" })).toBe("/family/portrait/p-1");
    expect(route("embryos.index")).toBe("/embryos");
    expect(route("embryos.upload")).toBe("/embryos/upload");
    expect(route("embryos.compare")).toBe("/embryos/compare");
    expect(route("settings.index")).toBe("/settings");
    expect(route("settings.data")).toBe("/settings/data");
    expect(route("settings.copilot")).toBe("/settings/copilot");
    expect(route("settings.people")).toBe("/settings/people");
    expect(route("settings.consents")).toBe("/settings/consents");
    expect(route("marketing.providers")).toBe("/providers");
    expect(route("science.index", { hash: "polygenic" })).toBe("/science#polygenic");
  });
});
