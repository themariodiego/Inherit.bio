import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import register from "../../../docs/route-register.json";
import { planClaimCaptures, type CapturePlanInput } from "./capture-plan";

function fixture(): CapturePlanInput {
  return { routeRegister: { stateIds: ["complete", "error"],
    stateProfiles: { "static-document": { supported: ["complete", "error"], notApplicable: {} } },
    routes: [{ id: "fixture.home", path: "/", kind: "page", auth: "public", disposition: "kept", stateProfile: "static-document" }],
    exportContracts: { "fixture-export": {} } },
    emailEntrypoints: ["src/emails/fixture-notice.tsx"],
    policyFor: () => ({ requiresClaimWrapping: false, requiredClaimRegions: ["fixture-prose"] }) };
}
const editRegister = (input: CapturePlanInput, edit: (r: typeof register) => void) => edit(input.routeRegister as typeof register);

describe("independent rendered-claim capture planning", () => {
  it("requires all four channels before any successful observation exists", () => {
    const captures = planClaimCaptures(fixture());
    expect(captures).toHaveLength(4);
    expect(new Set(captures.map((c) => c.required.channel))).toEqual(new Set(["static-build", "seeded-authenticated", "email", "export"]));
    expect(captures.find((c) => c.required.channel === "static-build")?.source).toMatchObject({ path: "/", state: "complete" });
    expect(captures.find((c) => c.required.channel === "seeded-authenticated")?.source).toMatchObject({ path: "/", state: "error" });
  });
  it("enumerates every actual canonical page/state plus discovered email and registered export", () => {
    const emails = readdirSync("src/emails").filter((p) => p.endsWith(".tsx") && p !== "base.tsx").map((p) => `src/emails/${p}`);
    const captures = planClaimCaptures({ ...fixture(), routeRegister: register, emailEntrypoints: emails });
    for (const route of register.routes.filter((r) => r.kind === "page")) {
      const profile = register.stateProfiles[route.stateProfile as keyof typeof register.stateProfiles];
      for (const state of profile.supported) expect(captures.filter((c) => c.source.kind === "route" && c.source.id === route.id && c.source.state === state)).toHaveLength(1);
    }
    expect(captures.filter((c) => c.source.kind === "email")).toHaveLength(emails.length);
    expect(captures.filter((c) => c.source.kind === "export")).toHaveLength(Object.keys(register.exportContracts).length);
  });
  it("newly registered pages automatically add their full state inventory", () => {
    const input = fixture(); editRegister(input, (r) => { r.routes.push({ ...r.routes[0], id: "fixture.second", path: "/second" }); });
    expect(planClaimCaptures(input).filter((c) => c.source.kind === "route")).toHaveLength(4);
  });
  it("dynamic and authenticated complete pages require seeded rendering, not fabricated build HTML", () => {
    const input = fixture(); editRegister(input, (r) => { r.routes[0].path = "/fixture/[id]"; });
    expect(planClaimCaptures(input).filter((c) => c.source.kind === "route").every((c) => c.required.channel === "seeded-authenticated")).toBe(true);
    editRegister(input, (r) => { r.routes[0].path = "/fixture"; r.routes[0].auth = "authenticated"; });
    expect(planClaimCaptures(input).filter((c) => c.source.kind === "route").every((c) => c.required.channel === "seeded-authenticated")).toBe(true);
  });
  it("never treats a missing policy as an uncited-surface exemption", () => {
    const input = fixture(); input.policyFor = () => undefined as never;
    expect(() => planClaimCaptures(input)).toThrow("invalid-region-policy");
  });
  it("refuses a silently omitted state", () => {
    const input = fixture(); editRegister(input, (r) => { r.stateProfiles["static-document"].supported = ["complete"]; });
    expect(() => planClaimCaptures(input)).toThrow("undeclared-state");
  });
  it("accepts an explicit structural state exemption with a reason", () => {
    const input = fixture(); editRegister(input, (r) => { r.stateProfiles["static-document"].supported = ["complete"]; Object.assign(r.stateProfiles["static-document"].notApplicable, { error: "Synthetic structure cannot enter this state." }); });
    expect(planClaimCaptures(input).filter((c) => c.source.kind === "route")).toHaveLength(1);
  });
  it("rejects duplicate route IDs and duplicate source paths", () => {
    const input = fixture(); editRegister(input, (r) => { r.routes.push({ ...r.routes[0] }); });
    expect(() => planClaimCaptures(input)).toThrow("duplicate-page");
    const second = fixture(); second.emailEntrypoints = [...second.emailEntrypoints, ...second.emailEntrypoints];
    expect(() => planClaimCaptures(second)).toThrow("duplicate-capture");
  });
  it("rejects an unknown route kind instead of silently omitting its page", () => {
    const input = fixture();
    editRegister(input, (r) => { r.routes.push({ ...r.routes[0], id: "fixture.missing", path: "/missing", kind: "paeg" }); });
    expect(() => planClaimCaptures(input)).toThrow("invalid-route");
  });
  it.each(["pages", "emails", "exports"])("refuses missing %s inventory", (kind) => {
    const input = fixture();
    if (kind === "pages") editRegister(input, (r) => { r.routes = []; });
    if (kind === "emails") input.emailEntrypoints = [];
    if (kind === "exports") editRegister(input, (r) => { r.exportContracts = {} as typeof r.exportContracts; });
    expect(() => planClaimCaptures(input)).toThrow("inventory");
  });
  it("does not mistake a composition-only email layout for a deliverable message", () => {
    const input = fixture(); input.emailEntrypoints = ["src/emails/base.tsx"];
    expect(() => planClaimCaptures(input)).toThrow("invalid-email-entrypoint");
  });
  it("copies region policies rather than sharing mutable input arrays", () => {
    const input = fixture(); const regions = ["fixture-prose"];
    input.policyFor = () => ({ requiresClaimWrapping: false, requiredClaimRegions: regions });
    const captures = planClaimCaptures(input); regions.push("another");
    expect(captures.every((c) => c.required.requiredClaimRegions.length === 1)).toBe(true);
  });
});
