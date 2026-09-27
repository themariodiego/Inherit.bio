/**
 * One-click presets for the Copilot model form. A preset is a client-side
 * convenience only: it fills the same `provider` and `base_url` the form has
 * always sent, and the server applies its usual validation, endpoint and
 * consent rules to the result. Nothing here widens what can be saved.
 *
 * No model is named. Model names change often, so the person copies one from
 * their provider's own list. The fixed addresses are the providers' public
 * OpenAI-compatible API roots, reached through the same `openai_compatible`
 * path as any other HTTPS endpoint.
 *
 * The order is neutral: the three named providers alphabetically, then the
 * free-form endpoint that behaves exactly as the form did before presets.
 */
export const COPILOT_PROVIDER_PRESETS = ["anthropic", "openai", "xai", "custom"] as const;
export type CopilotProviderPreset = (typeof COPILOT_PROVIDER_PRESETS)[number];
export type CopilotProvider = "anthropic" | "openai_compatible";
export type CopilotNamedPreset = Exclude<CopilotProviderPreset, "custom">;

const FIXED_TARGETS: Record<CopilotNamedPreset, { provider: CopilotProvider; baseUrl: string | null }> = {
  anthropic: { provider: "anthropic", baseUrl: null },
  openai: { provider: "openai_compatible", baseUrl: "https://api.openai.com/v1" },
  xai: { provider: "openai_compatible", baseUrl: "https://api.x.ai/v1" },
};

export function isCopilotProviderPreset(value: string): value is CopilotProviderPreset {
  return (COPILOT_PROVIDER_PRESETS as readonly string[]).includes(value);
}

/** The fixed address a preset fills in, or null when the person types it (custom) or none is sent (anthropic). */
export function copilotPresetBaseUrl(preset: CopilotProviderPreset): string | null {
  return preset === "custom" ? null : FIXED_TARGETS[preset].baseUrl;
}

/**
 * The `provider` and `base_url` a save sends for this preset. The custom
 * endpoint passes the typed address through untouched, exactly as before.
 */
export function copilotPresetTarget(
  preset: CopilotProviderPreset,
  customBaseUrl: string,
): { provider: CopilotProvider; base_url: string | null } {
  if (preset === "custom") return { provider: "openai_compatible", base_url: customBaseUrl };
  const target = FIXED_TARGETS[preset];
  return { provider: target.provider, base_url: target.baseUrl };
}

/**
 * The preset a stored configuration reads back as. Only an exact match of a
 * fixed address (ignoring a trailing slash) counts as that preset; anything
 * else stays a custom endpoint so its address remains editable.
 */
export function copilotPresetFor(
  current: { provider: CopilotProvider; base_url: string | null } | null,
): CopilotProviderPreset {
  if (!current || current.provider === "anthropic") return "anthropic";
  const saved = current.base_url?.replace(/\/+$/, "");
  const named = (["openai", "xai"] as const).find((preset) => FIXED_TARGETS[preset].baseUrl === saved);
  return named ?? "custom";
}
