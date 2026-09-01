import { describe, expect, it } from "vitest";
import {
  containsName,
  foldWords,
  scanDenylist,
  scanEvaluativeProximity,
} from "./name-gate";

describe("name gate normalization", () => {
  it("finds lowercase domain fragments", () => {
    const denied = ["outside", "genome"].join("");
    const text = ["https", "://outside", "genome.example/results"].join("");
    expect(containsName(text, denied)).toBe(true);
  });

  it("finds camelCase, kebab-case, snake_case, and compact forms", () => {
    const denied = ["outside", "genome"].join(" ");
    for (const text of [
      ["outside", "Genome"].join(""),
      ["outside", "-genome"].join(""),
      ["outside", "_genome"].join(""),
      ["outside", "genome"].join(""),
    ]) {
      expect(containsName(text, denied)).toBe(true);
    }
  });

  it("does not match a short name inside an unrelated longer token", () => {
    expect(containsName("metadata", ["me", "ta"].join(""))).toBe(false);
  });

  it("normalizes identifier and URL punctuation consistently", () => {
    expect(foldWords("OutsideGenome.example_path")).toEqual([
      "outside",
      "genome",
      "example",
      "path",
    ]);
  });

  it("permits a denied provider only inside the narrow directory carve-out", () => {
    const denied = ["outside", "genome"].join("");
    expect(
      scanDenylist(
        `{"name":"${denied}"}`,
        "data/providers/providers.json",
        [denied],
      ),
    ).toEqual([]);
    expect(scanDenylist(denied, "README.md", [denied])).toHaveLength(1);
    expect(
      scanDenylist(denied, "data/providers/providers.json", [denied], "a".repeat(40)),
    ).toHaveLength(1);
  });

  it("finds evaluative provider proximity within the 200-character window", () => {
    const provider = ["Outside", "Genome"].join("");
    const token = ["bet", "ter than"].join("");
    expect(
      scanEvaluativeProximity(
        `${provider}${" ".repeat(150)}is ${token} the rest`,
        "docs/review.md",
        [provider],
        [token],
      ),
    ).toHaveLength(1);
    expect(
      scanEvaluativeProximity(
        `${provider}${" ".repeat(450)}is ${token} the rest`,
        "docs/review.md",
        [provider],
        [token],
      ),
    ).toEqual([]);
  });
});
