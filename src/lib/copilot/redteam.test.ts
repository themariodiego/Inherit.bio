import { describe, expect, it } from "vitest";
import allowedConfig from "../../../config/allowed-numerals.json";
import redteam from "../../../e2e/fixtures/copilot-redteam.json";
import { REFUSAL_IDS, refusalFor } from "@/copy/copilot/refusals";
import { checkRelativeRisk, checkResponse, checkResponseNumerals, checkResponsePolicy, classifyIntent, type AllowedNumerals } from "./guard";

/**
 * The G4.8 prompt set (brief line 2635) at unit speed: every prompt is either
 * refused by the intent gate or allowed and answered by a maximally violating
 * completion the output guard must replace. `e2e/copilot-redteam.spec.ts`
 * runs the same set through the shipped route on the local-model path; this
 * file is what makes the record honest before that run and keeps it honest
 * after (an edit to the guard that lets a completion through fails here).
 */
const ALLOWED = allowedConfig as AllowedNumerals;
const SELF = { kind: "self" as const, displayLabel: "You" };
type Case = {
  id: string; class: string; gate: "input" | "output" | "revoked"; prompt: string; refusal?: string;
  tool?: { name: string; arguments: Record<string, unknown> }; answer?: string; toolJson?: unknown;
  mustContain?: string[]; mustNotContain?: string[]; rule?: "relative" | "numeral";
};
const CASES = redteam.cases as Case[];
const CLASSES = ["determinism", "embryo-ranking", "relative-risk", "medical-advice", "third-party", "revoked-grant"] as const;

describe("G4.8 red-team prompt set", () => {
  it("holds at least 40 prompts over the six classes the brief lists, each id once", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CASES.map(c => c.id)).size).toBe(CASES.length);
    for (const klass of CLASSES) expect(CASES.filter(c => c.class === klass).length, klass).toBeGreaterThanOrEqual(4);
    for (const c of CASES) {
      expect(CLASSES).toContain(c.class);
      expect(["input", "output", "revoked"]).toContain(c.gate);
      if (c.gate === "input") { expect(c.refusal).toBeDefined(); expect(c.tool).toBeUndefined(); expect(c.answer).toBeUndefined(); }
      else { expect(c.tool).toBeDefined(); expect(typeof c.answer).toBe("string"); expect(c.toolJson).toBeDefined(); }
      if (c.refusal) expect(REFUSAL_IDS).toContain(c.refusal);
    }
  });

  it("every input case is refused by the intent gate with the refusal the record names", () => {
    for (const c of CASES.filter(c => c.gate === "input")) {
      expect(classifyIntent(c.prompt, SELF).intent, `${c.id} ${c.prompt}`).toBe(c.refusal);
    }
  });

  it("every provider-bound case is an allowed prompt whose adversarial completion the output guard replaces whole", () => {
    for (const c of CASES.filter(c => c.gate !== "input")) {
      expect(classifyIntent(c.prompt, SELF).intent, `${c.id} ${c.prompt}`).toBe("allowed");
      const verdict = checkResponse(c.answer!, c.toolJson, ALLOWED);
      if (c.refusal) expect(verdict, `${c.id} ${c.answer}`).toMatchObject({ ok: false, violation: c.refusal });
      else {
        expect(verdict, `${c.id} ${c.answer}`).toEqual({ ok: true });
        for (const text of c.mustContain ?? []) expect(c.answer).toContain(text);
        for (const text of c.mustNotContain ?? []) expect(c.answer).not.toContain(text);
      }
    }
  });

  it("names the check that refuses each relative-risk completion", () => {
    const relative = CASES.filter(c => c.class === "relative-risk");
    expect(relative.filter(c => c.rule === "relative").length).toBeGreaterThanOrEqual(4);
    expect(relative.filter(c => c.rule === "numeral").length).toBeGreaterThanOrEqual(4);
    for (const c of relative) {
      const numerals = checkResponseNumerals(c.answer!, c.toolJson, ALLOWED);
      if (c.rule === "relative") {
        // The numbers pass the numeral check; only the relative-risk rule stands between the claim and the reader.
        expect(numerals.ok, `${c.id} numerals`).toBe(true);
        expect(checkRelativeRisk(c.answer!).ok, `${c.id} relative`).toBe(false);
      } else {
        expect(numerals.ok, `${c.id} numerals`).toBe(false);
      }
    }
  });

  it("no refusal string is itself a prohibited pattern, a relative risk or an unsupported number", () => {
    for (const id of REFUSAL_IDS) {
      const text = refusalFor(id, "You");
      expect(checkResponsePolicy(text).intent, id).toBe("allowed");
      expect(checkRelativeRisk(text).ok, id).toBe(true);
      expect(checkResponseNumerals(text, [], ALLOWED).ok, id).toBe(true);
    }
  });
});
