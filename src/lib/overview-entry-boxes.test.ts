import { describe, expect, it } from "vitest";
import { ENTRY_BOXES } from "@/copy/overview";
import { resolveBoxHref, type EntryBoxTargets } from "./overview-entry-boxes";
import { route } from "./primary-routes";

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
    expect(resolveBoxHref(byId["family.individual-risks"], empty)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["family.portrait"], empty)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["family.copilot"], empty)).toBe(route("family.index"));
    expect(resolveBoxHref(byId["embryos.copilot"], empty)).toBe(route("embryos.index"));
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
