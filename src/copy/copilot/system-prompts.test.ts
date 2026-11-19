import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import claims from "../../../data/claims.json";
import {
  COHORT_SYSTEM_PROMPT as COHORT_FROM_CONTENT,
  cohortSystemMessage,
  type CopilotCohortContext,
} from "@/lib/copilot/cohort-chat-content";
import {
  COHORT_SYSTEM_PROMPT,
  COPILOT_PROMPT_RULES,
  FAMILY_SYSTEM_PROMPT,
  OWN_SOURCE_RULES,
  OWN_SYSTEM_PROMPT,
  cohortSystemText,
  copilotPromptRules,
  familySystemMessage,
  ownLegacySystemMessage,
  ownSystemMessage,
  promptRuleTexts,
} from "./system-prompts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * SHA-256 of what the pre-move code sent at commit 033dbbf4, for the fixed
 * inputs below. Each digest was computed from that commit's own template
 * literals: `SYSTEM_PROMPT` and the legacy `fileNote` in
 * src/app/api/chat/route.ts, the `system` template in
 * src/lib/copilot/own-chat-route.ts, `FAMILY_SYSTEM_PROMPT` and its
 * `readableNow` line in src/lib/copilot/family-chat-route.ts, and
 * `COHORT_SYSTEM_PROMPT` with `cohortSystemMessage` in
 * src/lib/copilot/cohort-chat-content.ts. The move to this module must not
 * change one byte of what a model receives.
 */
const BEFORE_MOVE = {
  ownPrompt: "fddf72c0ace91e3425781107d8a59e06fceb1abd97b8dde61e17363078586ffe",
  familyPrompt: "59f66ab6a13ae728c1d405fbe867cb454d3992c328ff9c20b5a4f0ebd749577e",
  cohortPrompt: "72c34adf19f76e615ee250e38e410475729aa1bd3f2f53902d2b776144d7ba7d",
  ownCanonical: "c7083a4d12f6d41744ebf198deb14710967996d1edfc501d9ba51ea3a449cbab",
  ownLegacyTwoFiles: "8377c4ea8d626647933e2d39ce0a561f66091209c8b71fea8e91d21aeb2e75bd",
  ownLegacyNoFile: "98394d90483527c69f419379f23007ca9740053a83e2d96e64326ac85a83efb7",
  familyTwoReaders: "81e588a28bed55185e44266ffd1122b7e406c963367e57ab0ae59006d013fb95",
  familyNobody: "02c204967664e3a8fabe50a08a40ce814ddcbb42097719f4e72bd8541a96ba2a",
  cohort: "35ab512de0a940dd2a841346627cc48c51d1694cbc29bd235b73d01c23c1a67a",
} as const;

const SUBJECT = "Sam Example";
const READERS = [{ displayLabel: "Ana", ref: "p1" }, { displayLabel: "Ben", ref: "p2" }];
const COHORT_CONTEXT = { cohort_id: "c1", embryos: [] };

describe("the Copilot system prompts moved without a byte changing", () => {
  it("keeps each prompt constant byte-identical", () => {
    expect(sha256(OWN_SYSTEM_PROMPT)).toBe(BEFORE_MOVE.ownPrompt);
    expect(sha256(FAMILY_SYSTEM_PROMPT)).toBe(BEFORE_MOVE.familyPrompt);
    expect(sha256(COHORT_SYSTEM_PROMPT)).toBe(BEFORE_MOVE.cohortPrompt);
  });

  it("assembles the canonical own-scope message as own-chat-route.ts did", () => {
    expect(sha256(ownSystemMessage(OWN_SYSTEM_PROMPT, SUBJECT))).toBe(BEFORE_MOVE.ownCanonical);
    expect(ownSystemMessage("Answer from tools.", SUBJECT)).toBe(
      `Answer from tools.\nThe authorized subject is ${SUBJECT}. ${OWN_SOURCE_RULES}`,
    );
  });

  it("assembles both legacy own-scope messages as the chat route did", () => {
    expect(sha256(ownLegacySystemMessage(SUBJECT, 2))).toBe(BEFORE_MOVE.ownLegacyTwoFiles);
    expect(sha256(ownLegacySystemMessage(SUBJECT, 0))).toBe(BEFORE_MOVE.ownLegacyNoFile);
  });

  it("assembles the Family message for two readers and for nobody", () => {
    expect(sha256(familySystemMessage(READERS))).toBe(BEFORE_MOVE.familyTwoReaders);
    expect(sha256(familySystemMessage([]))).toBe(BEFORE_MOVE.familyNobody);
  });

  it("assembles the cohort message, through the content module the cohort route calls", () => {
    expect(sha256(cohortSystemText(JSON.stringify(COHORT_CONTEXT)))).toBe(BEFORE_MOVE.cohort);
    expect(sha256(cohortSystemMessage(COHORT_CONTEXT as unknown as CopilotCohortContext))).toBe(BEFORE_MOVE.cohort);
    expect(COHORT_FROM_CONTENT).toBe(COHORT_SYSTEM_PROMPT);
  });

  it("is what every route sends, and no route writes prompt text of its own", () => {
    const chat = readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(chat).toContain("{ systemPrompt: OWN_SYSTEM_PROMPT, refusal: refusalResponse }");
    expect(chat).toContain("system: ownLegacySystemMessage(subject.displayLabel, files.length),");
    expect(chat).not.toContain("Hard rules:");
    const own = readFileSync("src/lib/copilot/own-chat-route.ts", "utf8");
    expect(own).toContain("system: ownSystemMessage(options.systemPrompt, subject.displayLabel),");
    const family = readFileSync("src/lib/copilot/family-chat-route.ts", "utf8");
    expect(family).toContain("system: familySystemMessage(members),");
    expect(family).toContain("export { FAMILY_SYSTEM_PROMPT } from '@/copy/copilot/system-prompts';");
    const cohortRoute = readFileSync("src/lib/copilot/cohort-chat-route.ts", "utf8");
    expect(cohortRoute).toContain("system: cohortSystemMessage(context),");
    for (const source of [chat, own, family, cohortRoute, readFileSync("src/lib/copilot/cohort-chat-content.ts", "utf8")]) {
      expect(source).not.toContain("Hard rules:");
    }
  });
});

/** The rules registered as claims, as the owner's 16 October 2026 decision requires. Pending source review. */
const CLAIM_RULES = [
  "own.informational",
  "own.grounding",
  "own.coverage",
  "own.sensitive-topics",
  "own.unavailable-scores",
  "own.unavailable-sources",
  "family.informational",
  "family.unshared-reports",
  "cohort.informational",
  "cohort.no-condition-results",
  "cohort.standing-statement",
];

describe("the prompt rules and their claims", () => {
  it("names every rule of every constant in order, and the rules rebuild each prompt exactly", () => {
    const rules = copilotPromptRules();
    expect(rules).toHaveLength(22);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    for (const [part, text] of [
      ["OWN_SYSTEM_PROMPT", OWN_SYSTEM_PROMPT],
      ["FAMILY_SYSTEM_PROMPT", FAMILY_SYSTEM_PROMPT],
      ["COHORT_SYSTEM_PROMPT", COHORT_SYSTEM_PROMPT],
    ] as const) {
      const lines = rules.filter((rule) => rule.part === part).map((rule) => `- ${rule.text}`);
      expect(lines).toHaveLength(COPILOT_PROMPT_RULES[part].length);
      expect(`${text.slice(0, text.indexOf("\n\nHard rules:\n"))}\n\nHard rules:\n${lines.join("\n")}`).toBe(text);
    }
    expect(promptRuleTexts(OWN_SOURCE_RULES)).toEqual([OWN_SOURCE_RULES]);
    expect(() => promptRuleTexts("Intro.\n\nHard rules:\n- One.\nNot a rule.")).toThrow(/not a rule/);
  });

  it("classes exactly these rules as claims and registers each with its exact text and no review", () => {
    const rules = copilotPromptRules();
    expect(rules.filter((rule) => rule.kind === "claim").map((rule) => rule.id)).toEqual(CLAIM_RULES);
    const registered = claims.filter((claim) => claim.claim_id.startsWith("copilot."));
    expect(registered.map((claim) => claim.claim_id).sort()).toEqual(CLAIM_RULES.map((id) => `copilot.${id}`).sort());
    for (const rule of rules) {
      const claim = registered.find((entry) => entry.claim_id === `copilot.${rule.id}`);
      if (rule.kind === "instruction") {
        expect(claim, rule.id).toBeUndefined();
        continue;
      }
      expect(claim, rule.id).toBeDefined();
      expect(claim!.text_verbatim).toBe(rule.text);
      expect(claim!.surfaces).toEqual([`copilot:${rule.id}`]);
      // Registration is not review: no source is attached and none is claimed.
      expect(claim!.evidence).toEqual([]);
      expect(claim!.reviewed_on).toBeNull();
      expect(claim!.reviewer).toBeNull();
      expect(claim!.net_impression_note).toContain("Pending the owner's scientific source review");
    }
  });
});
