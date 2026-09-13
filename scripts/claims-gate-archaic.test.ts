import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ARCHAIC_RANKING_PATTERNS, archaicFindings, type ArchaicSource } from "./claims-gate";

/**
 * Brief §7.6 requires positive and negative fixtures for the archaic-ranking
 * rule to be checked in. They live here rather than under `src/`, because a
 * positive fixture is by definition a string the gate must refuse, and the
 * gate's own sweep reads `src/` — a fixture parked there would fail the gate
 * it exists to test.
 *
 * The rule is in place before the estimate it constrains. `NeanderthalCard`
 * withholds the number today, so nothing in the tree can trip it yet; these
 * fixtures are what make the rule provably live in the meantime rather than
 * a regex nobody has run against anything.
 */

const REFUSED = [
  "Your result shows more Neanderthal than most people in the reference set.",
  "You are in the 92nd Neanderthal percentile.",
  "Your Neanderthal rank among Inherit users is high.",
  "This is your Neanderthal score.",
  // Case is not a way around it.
  "MORE NEANDERTHAL THAN average.",
  "Neanderthal Percentile: 92.",
];

const ALLOWED = [
  "Most people with ancestry outside Africa carry between 1 and 4 in 100.",
  "Inherit does not estimate Denisovan ancestry yet, so this number is about Neanderthals only.",
  "We can’t show this yet. Inherit has not yet built and licence-checked the marker list this needs, and we will not guess. This page will say so until that changes.",
  "How much of your DNA came from Neanderthals",
  // Ranking words that are not about archaic ancestry are not this rule's business.
  "Your polygenic score sits in the 40th percentile.",
];

const source = (text: string): ArchaicSource => ({ path: "fixture.tsx", text });

describe("archaic ancestry is never ranked (brief §7.6)", () => {
  it("refuses every ranking fixture", () => {
    for (const text of REFUSED) {
      expect(archaicFindings([source(text)], []), text).toHaveLength(1);
    }
  });

  it("passes every honest fixture", () => {
    for (const text of ALLOWED) {
      expect(archaicFindings([source(text)], []), text).toEqual([]);
    }
  });

  it("names the file and the line of each finding", () => {
    const findings = archaicFindings(
      [{ path: "src/copy/ancestry.ts", text: "one\ntwo\nYour Neanderthal score is high.\n" }],
      [],
    );
    expect(findings).toEqual([
      "src/copy/ancestry.ts:3: archaic ancestry is not a score (brief §7.6): Neanderthal score",
    ]);
  });

  it("exempts a match only inside a pinned sentence, and only there", () => {
    const pinned = "This is not a score. A higher or lower share is not better, worse, healthier, or more anything. Inherit does not rank people on it.";
    // The pinned sentence carries no ranking pattern of its own, so pin one
    // that does: the exemption must turn on the sentence, not on the file.
    const exempt = "We do not tell you whether you have more Neanderthal than anyone else.";
    expect(archaicFindings([source(exempt)], [exempt])).toEqual([]);
    expect(archaicFindings([source(exempt)], [])).toHaveLength(1);
    // A pin is by sentence, never by file: the same wording elsewhere is still
    // the one permitted occurrence, and a second copy is not.
    expect(archaicFindings(
      [{ path: "a.tsx", text: exempt }, { path: "b.tsx", text: exempt }],
      [exempt],
    )).toEqual([
      `data/gates/archaic-allowlist.json pins one occurrence but the tree holds 2: ${exempt}`,
    ]);
    // A pinned sentence that has gone from the tree is a stale pin, not a pass.
    expect(archaicFindings([source("nothing here")], [pinned])).toEqual([
      `data/gates/archaic-allowlist.json pins a sentence that appears nowhere: ${pinned}`,
    ]);
  });

  it("ships the allowlist the brief names, empty and explained", () => {
    const file = JSON.parse(
      readFileSync(path.join(process.cwd(), "data/gates/archaic-allowlist.json"), "utf8"),
    ) as { sentences: unknown; empty_because?: unknown };
    expect(Array.isArray(file.sentences)).toBe(true);
    // Empty is the strongest state, and it stays empty until someone writes
    // the two pages. If a pin is ever added, the reason field must go.
    expect(file.sentences).toEqual([]);
    expect(typeof file.empty_because).toBe("string");
  });

  it("uses exactly the two patterns the brief states", () => {
    expect(ARCHAIC_RANKING_PATTERNS.map(String)).toEqual([
      "/more Neanderthal than/i",
      "/Neanderthal (percentile|rank|score)/i",
    ]);
  });
});
