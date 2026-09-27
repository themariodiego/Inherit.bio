import { describe, expect, it } from "vitest";
import { ssrfReasonForBaseUrl } from "@/lib/llm";
import { modelRuntime, normalizeModelEndpoint } from "./model-endpoint";
import {
  COPILOT_PROVIDER_PRESETS,
  copilotPresetBaseUrl,
  copilotPresetFor,
  copilotPresetTarget,
  isCopilotProviderPreset,
} from "./provider-presets";

describe("Copilot provider presets", () => {
  it("lists the three named providers alphabetically, then the custom endpoint", () => {
    expect(COPILOT_PROVIDER_PRESETS).toEqual(["anthropic", "openai", "xai", "custom"]);
  });

  it("maps each named preset to the provider and base URL the form already sends", () => {
    expect(copilotPresetTarget("anthropic", "https://ignored.example.test/v1")).toEqual({ provider: "anthropic", base_url: null });
    expect(copilotPresetTarget("openai", "https://ignored.example.test/v1")).toEqual({
      provider: "openai_compatible", base_url: "https://api.openai.com/v1" });
    expect(copilotPresetTarget("xai", "https://ignored.example.test/v1")).toEqual({
      provider: "openai_compatible", base_url: "https://api.x.ai/v1" });
  });

  it("passes the custom address through untouched, whatever was typed", () => {
    for (const typed of ["https://models.example.test/v1", "http://localhost:11434/v1", "https://api.openai.com/v1/", "", "not a url"]) {
      expect(copilotPresetTarget("custom", typed)).toEqual({ provider: "openai_compatible", base_url: typed });
    }
    expect(copilotPresetBaseUrl("custom")).toBeNull();
  });

  it("fills an address only for the presets that have one", () => {
    expect(copilotPresetBaseUrl("anthropic")).toBeNull();
    expect(copilotPresetBaseUrl("openai")).toBe("https://api.openai.com/v1");
    expect(copilotPresetBaseUrl("xai")).toBe("https://api.x.ai/v1");
  });

  it("reads a stored configuration back as its preset only on an exact address match", () => {
    expect(copilotPresetFor(null)).toBe("anthropic");
    expect(copilotPresetFor({ provider: "anthropic", base_url: null })).toBe("anthropic");
    expect(copilotPresetFor({ provider: "openai_compatible", base_url: "https://api.openai.com/v1" })).toBe("openai");
    expect(copilotPresetFor({ provider: "openai_compatible", base_url: "https://api.openai.com/v1/" })).toBe("openai");
    expect(copilotPresetFor({ provider: "openai_compatible", base_url: "https://api.x.ai/v1" })).toBe("xai");
    for (const other of ["https://models.example.test/v1", "https://api.openai.com/v2", "https://api.openai.com.example.test/v1",
      "http://api.x.ai/v1", "http://localhost:11434/v1", null]) {
      expect(copilotPresetFor({ provider: "openai_compatible", base_url: other }), String(other)).toBe("custom");
    }
    for (const preset of COPILOT_PROVIDER_PRESETS.filter((p) => p !== "custom")) {
      expect(copilotPresetFor(copilotPresetTarget(preset, ""))).toBe(preset);
    }
  });

  it("accepts only its own preset identifiers from the select", () => {
    for (const preset of COPILOT_PROVIDER_PRESETS) expect(isCopilotProviderPreset(preset)).toBe(true);
    for (const other of ["openai_compatible", "grok", "", "OpenAI"]) expect(isCopilotProviderPreset(other)).toBe(false);
  });

  it("uses fixed addresses that the unchanged server endpoint rules accept as hosted cloud endpoints", () => {
    const hosted = modelRuntime({ VERCEL: "1" });
    for (const preset of ["openai", "xai"] as const) {
      const url = copilotPresetBaseUrl(preset)!;
      const endpoint = normalizeModelEndpoint(url, hosted);
      expect(endpoint.baseUrl).toBe(url);
      expect(endpoint.providerClass).toBe("cloud");
      expect(ssrfReasonForBaseUrl(url, false)).toBeNull();
    }
  });
});
