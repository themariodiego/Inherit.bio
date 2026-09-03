import { describe, expect, it } from "vitest";
import { SUBJECT_COLOUR_COUNT, stableHash, subjectColourIndex, subjectInitial } from "./subject-colour";

describe("subject colour", () => {
  it("is stable for the same id and within the eight tokens", () => {
    const id = "6b1f4d6e-4c1a-4a7e-9b2f-1c2d3e4f5a6b";
    const first = subjectColourIndex({ id, subjectClass: "other_adult" });
    expect(first).toBe(subjectColourIndex({ id, subjectClass: "other_adult" }));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(SUBJECT_COLOUR_COUNT);
  });

  it("uses token 0 for the self subject regardless of id", () => {
    expect(subjectColourIndex({ id: "anything", subjectClass: "self" })).toBe(0);
  });

  it("spreads ids across tokens", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) {
      seen.add(subjectColourIndex({ id: `subject-${i}`, subjectClass: "embryo" }));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("hashes deterministically", () => {
    expect(stableHash("")).toBe(0x811c9dc5);
    expect(stableHash("a")).toBe(stableHash("a"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("takes the initial from the display name", () => {
    expect(subjectInitial("maya")).toBe("M");
    expect(subjectInitial("  Émile")).toBe("É");
    expect(subjectInitial("")).toBe("?");
  });
});
