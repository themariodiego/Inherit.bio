import type { CopilotNamedPreset, CopilotProviderPreset } from "@/lib/copilot/provider-presets";

/**
 * The words of the Copilot provider presets on `/settings/copilot`.
 *
 * Three things have to be true of this copy:
 *
 *   1. It is neutral. The providers are named in alphabetical order and
 *      nothing here ranks, rates or prices them. The custom endpoint comes
 *      last because it is the one that asks for more of the person.
 *   2. It never names a model. Model names change often; the person copies
 *      one from their provider's own list.
 *   3. It does not contradict the Copilot permission. Saving sends nothing;
 *      the permission below the form (or the chat's consent dialog) is what
 *      allows anything to be sent, and it lists exactly what that is.
 */

/** The choices in the Provider list, in the order the list renders them. */
export const COPILOT_PRESET_NAMES: Record<CopilotProviderPreset, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT models)",
  xai: "xAI (Grok)",
  custom: "Custom OpenAI-compatible endpoint",
};

export const COPILOT_PRESET_GUIDE_HEADING = "Before you save";

const SPENDING = "In that console, set a monthly spending limit.";

/** Shown under the Provider list for each named preset, in this order. */
export const COPILOT_PRESET_GUIDES: Record<
  CopilotNamedPreset,
  { key: string; spending: string; subscription: string; disclosure: string }
> = {
  anthropic: {
    key: "Create an API key in the Anthropic developer console and paste it below.",
    spending: SPENDING,
    subscription:
      "An API key is separate from a Claude subscription such as Claude Pro. A subscription cannot be used here.",
    disclosure:
      "When you ask Copilot a question, it sends some of your DNA results and your message to Anthropic. Nothing is sent until you give Copilot permission for this provider.",
  },
  openai: {
    key: "Create an API key in the OpenAI developer console and paste it below.",
    spending: SPENDING,
    subscription:
      "An API key is separate from a ChatGPT subscription such as ChatGPT Plus. A subscription cannot be used here.",
    disclosure:
      "When you ask Copilot a question, it sends some of your DNA results and your message to OpenAI. Nothing is sent until you give Copilot permission for this provider.",
  },
  xai: {
    key: "Create an API key in the xAI developer console and paste it below.",
    spending: SPENDING,
    subscription:
      "An API key is separate from a Grok subscription such as SuperGrok. A subscription cannot be used here.",
    disclosure:
      "When you ask Copilot a question, it sends some of your DNA results and your message to xAI. Nothing is sent until you give Copilot permission for this provider.",
  },
};

/** Under the Model field for the presets whose model is typed. */
export const COPILOT_PRESET_MODEL_HINTS: Record<Exclude<CopilotNamedPreset, "anthropic">, string> = {
  openai: "Copy a model name from OpenAI's list of models. Model names change often, so none is filled in here.",
  xai: "Copy a model name from xAI's list of models. Model names change often, so none is filled in here.",
};

/** Under the Base URL field when a preset filled it in. */
export const COPILOT_PRESET_ADDRESS_HINT =
  "This address is filled in for you. To use a different one, choose the custom endpoint.";
