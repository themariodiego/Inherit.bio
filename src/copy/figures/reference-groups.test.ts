import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, wordCount } from "../../../scripts/readability";
import { RETAINED_TERMS } from "@/lib/figures/contract";
import {
  BASELINE_ABSENT,
  NO_BASELINE_STATE,
  REFERENCE_GROUP_SHORT,
  TERM_DEFINITIONS,
  definitionFor,
  expandedReferenceGroup,
} from "./reference-groups";

describe("retained term definitions", () => {
  it("defines every retained term in at most 20 plain words at grade 9 or below", () => {
    for (const term of RETAINED_TERMS) {
      const definition = definitionFor(term);
      expect(definition).toBe(TERM_DEFINITIONS[term]);
      expect(wordCount(definition), term).toBeLessThanOrEqual(20);
      expect(fleschKincaidGrade(definition), term).toBeLessThanOrEqual(9);
    }
  });
});

describe("reference group wording", () => {
  it("expands people like you with whatever was matched", () => {
    expect(REFERENCE_GROUP_SHORT).toBe("people like you");
    expect(expandedReferenceGroup({ sex: "female", ageBand: "40 to 49", ancestryLabel: "ancestry like yours" })).toBe(
      "people like you — women aged 40 to 49 with ancestry like yours",
    );
    expect(expandedReferenceGroup({ sex: "male" })).toBe("people like you — men");
    expect(expandedReferenceGroup({ ageBand: "30 to 39" })).toBe("people like you — people aged 30 to 39");
    expect(expandedReferenceGroup({})).toBe("people like you — not matched on sex, age or ancestry");
  });

  it("pins the baseline-absent and no-baseline strings", () => {
    expect(BASELINE_ABSENT).toBe(
      "Baseline not shown: Inherit does not know your sex and age band. Add them in Settings, or read the range on its own.",
    );
    expect(NO_BASELINE_STATE("type 2 diabetes", "Sam")).toBe(
      "We cannot give you a number for type 2 diabetes. The models for this condition have only been checked in groups that do not match Sam’s background, so any number we showed would be wrong in a direction we cannot measure.",
    );
  });
});
