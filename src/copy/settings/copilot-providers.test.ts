import { describe, expect, it } from "vitest";
import evaluative from "../../../scripts/evaluative-tokens.json";
import { COPILOT_PROVIDER_PRESETS } from "@/lib/copilot/provider-presets";
import { ANTHROPIC_MODELS } from "@/lib/llm";
import {
  COPILOT_PRESET_ADDRESS_HINT,
  COPILOT_PRESET_GUIDE_HEADING,
  COPILOT_PRESET_GUIDES,
  COPILOT_PRESET_MODEL_HINTS,
  COPILOT_PRESET_NAMES,
} from "./copilot-providers";

const ALL = [
  ...Object.values(COPILOT_PRESET_NAMES),
  COPILOT_PRESET_GUIDE_HEADING,
  ...Object.values(COPILOT_PRESET_GUIDES).flatMap((guide) => Object.values(guide)),
  ...Object.values(COPILOT_PRESET_MODEL_HINTS),
  COPILOT_PRESET_ADDRESS_HINT,
];

const PROVIDER_WORDS = { anthropic: "Anthropic", openai: "OpenAI", xai: "xAI" } as const;
const SUBSCRIPTIONS = { anthropic: "Claude Pro", openai: "ChatGPT Plus", xai: "SuperGrok" } as const;

describe("Copilot provider preset copy", () => {
  it("names every preset, and only the named presets carry guidance", () => {
    expect(Object.keys(COPILOT_PRESET_NAMES)).toEqual([...COPILOT_PROVIDER_PRESETS]);
    expect(COPILOT_PRESET_NAMES.custom).toMatch(/OpenAI-compatible/);
    expect(Object.keys(COPILOT_PRESET_GUIDES)).toEqual(["anthropic", "openai", "xai"]);
    expect(Object.keys(COPILOT_PRESET_MODEL_HINTS)).toEqual(["openai", "xai"]);
  });

  it("tells each provider's reader where the key comes from, to cap spending, and that a subscription is not a key", () => {
    for (const preset of ["anthropic", "openai", "xai"] as const) {
      const guide = COPILOT_PRESET_GUIDES[preset];
      expect(guide.key).toContain(`${PROVIDER_WORDS[preset]} developer console`);
      expect(guide.spending).toMatch(/monthly spending limit/);
      expect(guide.subscription).toContain(SUBSCRIPTIONS[preset]);
      expect(guide.subscription).toMatch(/cannot be used here/);
    }
  });

  it("says what goes to the provider and that the Copilot permission, not saving, allows it", () => {
    for (const preset of ["anthropic", "openai", "xai"] as const) {
      const { disclosure } = COPILOT_PRESET_GUIDES[preset];
      expect(disclosure).toContain(`DNA results and your message to ${PROVIDER_WORDS[preset]}.`);
      expect(disclosure).toMatch(/Nothing is sent until you give Copilot permission/);
    }
  });

  it("names no model, so a changed model name cannot make it wrong", () => {
    for (const text of ALL) {
      for (const model of [...ANTHROPIC_MODELS, "llama"]) expect(text).not.toContain(model);
    }
    for (const hint of Object.values(COPILOT_PRESET_MODEL_HINTS)) expect(hint).toMatch(/^Copy a model name from /);
  });

  it("ranks, rates and prices nothing", () => {
    for (const text of ALL) {
      for (const token of evaluative.tokens) expect(text.toLowerCase(), text).not.toContain(token);
      expect(text, "no numbers or prices").not.toMatch(/[0-9$€£%]/);
    }
  });
});
