import { describe, expect, it, vi } from "vitest";
import { ENTRY_BOXES } from "@/copy/overview";
import { resolveBoxHref, type EntryBoxTargets } from "./overview-entry-boxes";
import { route } from "./primary-routes";
import { copilotGroupScopes } from "./copilot/group-scopes";

const UNBUILT = { family: false, cohort: false };
const FAMILY_BUILT = { family: true, cohort: false };

// Five accounts, because the four resolved boxes branch on what the account
// holds and a single shape would leave half of each branch unwalked.
const TARGETS: Record<string, EntryBoxTargets> = {
  "an account with neither an adult nor a cohort": { firstAdultSegment: null, cohortId: null, portraitPairId: null },
  "an account with an adult but no cohort": { firstAdultSegment: "adult-1", cohortId: null, portraitPairId: null },
  "an account with a cohort but no adult": { firstAdultSegment: null, cohortId: "cohort-1", portraitPairId: null },
  "an account with both": { firstAdultSegment: "adult-1", cohortId: "cohort-1", portraitPairId: null },
  "an account with a confirmed Portrait": { firstAdultSegment: "adult-1", cohortId: null, portraitPairId: "pair-1" },
};

describe("entry box targets", () => {
  // The count is asserted so a tenth box cannot be added without this file
  // being read: the hazard below is only unreachable while every box is
  // accounted for.
  it("resolves exactly the nine committed boxes", () => {
    expect(ENTRY_BOXES).toHaveLength(9);
  });

  it("never sends a box back to Overview, under any account shape", () => {
    const overview = route("app.overview");
    for (const [shape, targets] of Object.entries(TARGETS)) {
      for (const box of ENTRY_BOXES) {
        const href = resolveBoxHref(box, targets);
        // A self-link is what resolveBoxHref's `default` returns, so reaching
        // it means a box has neither a static href nor a case. The box would
        // render as a link from Overview to Overview and nothing else would
        // notice.
        expect(href, `${box.id} on ${shape} fell through to the Overview self-link`).not.toBe(overview);
        expect(href, `${box.id} on ${shape} resolved to an empty target`).toMatch(/^\//);
      }
    }
  });

  it("sends the four resolved boxes to their blocking state rather than a dead route", () => {
    const empty = TARGETS["an account with neither an adult nor a cohort"];
    const byId = Object.fromEntries(ENTRY_BOXES.map(b => [b.id, b]));
    expect(resolveBoxHref(byId["family.individual-risks"], empty, UNBUILT)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["family.portrait"], empty, UNBUILT)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["family.copilot"], empty, UNBUILT)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["embryos.copilot"], empty, UNBUILT)).toBe(route("embryos.index"));
  });

  it("opens the Family Copilot box on its group scope where that scope is built, and nowhere else", () => {
    const byId = Object.fromEntries(ENTRY_BOXES.map(b => [b.id, b]));
    for (const targets of Object.values(TARGETS)) {
      expect(resolveBoxHref(byId["family.copilot"], targets, FAMILY_BUILT)).toBe(route("copilot.scope", { scope: "family" }));
      expect(resolveBoxHref(byId["family.copilot"], targets, UNBUILT)).toBe(route("family.index"));
    }
  });

  // The owner turned the Family scope on everywhere on 2026-09-28 (PR #260):
  // with no scopes passed, which is how Overview calls it, the box goes where
  // the register's box contract says (`copilot.scope`, `family`) for every
  // account shape and in every environment, hosted production included.
  // The cohort scope is built under TEST-LOCAL only (2026-09-28): there the
  // Embryos box opens the account's newest cohort's scope, and it stays on the
  // hub everywhere else and for an account with no cohort.
  it("opens the Family Copilot box on /copilot/family by default, on every deployment", () => {
    const byId = Object.fromEntries(ENTRY_BOXES.map(b => [b.id, b]));
    for (const env of [{ INHERIT_TEST_JURISDICTION: "" }, { INHERIT_TEST_JURISDICTION: "1" },
      { INHERIT_TEST_JURISDICTION: "", VERCEL: "1", VERCEL_ENV: "production" }]) {
      vi.unstubAllEnvs();
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const testLocal = env.INHERIT_TEST_JURISDICTION === "1";
      expect(copilotGroupScopes(), JSON.stringify(env)).toEqual({ family: true, cohort: testLocal });
      for (const targets of Object.values(TARGETS)) {
        expect(resolveBoxHref(byId["family.copilot"], targets), JSON.stringify(env))
          .toBe(route("copilot.scope", { scope: "family" }));
        expect(resolveBoxHref(byId["embryos.copilot"], targets), JSON.stringify(env)).toBe(testLocal && targets.cohortId
          ? route("copilot.scope", { scope: `c-${targets.cohortId}` }) : route("embryos.index"));
      }
    }
    vi.unstubAllEnvs();
  });

  it("keeps the embryo Copilot box on the embryo hub until the cohort scope is built, and names a cohort in the register's grammar", () => {
    const byId = Object.fromEntries(ENTRY_BOXES.map(b => [b.id, b]));
    const withCohort = TARGETS["an account with a cohort but no adult"];
    expect(resolveBoxHref(byId["embryos.copilot"], withCohort, FAMILY_BUILT)).toBe(route("embryos.index"));
    expect(resolveBoxHref(byId["embryos.copilot"], withCohort, { family: true, cohort: true }))
      .toBe(route("copilot.scope", { scope: "c-cohort-1" }));
  });

  it("routes individual risks to the adult once the account has one", () => {
    const byId = Object.fromEntries(ENTRY_BOXES.map(b => [b.id, b]));
    expect(resolveBoxHref(byId["family.individual-risks"], TARGETS["an account with an adult but no cohort"]))
      .toBe(route("family.person", { person: "adult-1" }));
  });

  it("routes Portrait directly only when the server confirmed its pair", () => {
    const box = ENTRY_BOXES.find(box => box.id === "family.portrait")!;
    expect(resolveBoxHref(box, TARGETS["an account with a confirmed Portrait"]))
      .toBe(route("family.portrait", { pairId: "pair-1" }));
    expect(resolveBoxHref(box, TARGETS["an account with both"])).toBe(route("family.index"));
  });

  it("keeps every static target exactly as the copy declares it", () => {
    const empty = TARGETS["an account with neither an adult nor a cohort"];
    const statics = ENTRY_BOXES.filter(b => b.href);
    expect(statics).toHaveLength(5);
    for (const box of statics) expect(resolveBoxHref(box, empty)).toBe(box.href);
  });
});
