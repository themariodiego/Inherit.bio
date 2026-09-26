import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Execute the real client handlers with retained hook state, without a DOM,
// application server or network, as `src/components/chat/own-chat-panel.test.ts`
// does. The radix select is replaced by plain elements so its `onValueChange`
// can be called directly; layout and accessibility stay in browser CI.
const harness = vi.hoisted(() => ({ state: [] as unknown[], cursor: 0, refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.state)) harness.state[index] = initial;
    return [harness.state[index], (next: unknown) => { harness.state[index] = typeof next === "function"
      ? (next as (previous: unknown) => unknown)(harness.state[index]) : next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/input", () => ({ Input: "input" }));
vi.mock("@/components/ui/label", () => ({ Label: "label" }));
vi.mock("@/components/ui/select", () => ({ Select: "x-select", SelectTrigger: "x-select-trigger",
  SelectValue: "x-select-value", SelectContent: "x-select-content", SelectItem: "x-select-item" }));
import { LlmSettingsForm } from "./llm-settings-form";
import { COPILOT_PRESET_GUIDES, COPILOT_PRESET_MODEL_HINTS, COPILOT_PRESET_NAMES } from "@/copy/settings/copilot-providers";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/llm";

type Current = Parameters<typeof LlmSettingsForm>[0]["current"];
type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as Element, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}

let props: { current: Current; localAvailable?: boolean } = { current: null };
function render() { harness.cursor = 0; return LlmSettingsForm(props); }
function providerSelect(tree: ReactNode) {
  const trigger = elements(tree).findIndex(node => node.type === "x-select-trigger" && node.props.id === "llm-provider");
  const select = elements(tree).slice(0, trigger).reverse().find(node => node.type === "x-select");
  if (!select) throw new Error("Expected the provider select");
  return select.props as { value: string; onValueChange: (value: string) => void };
}
function field(tree: ReactNode, id: string) {
  const found = elements(tree).find(node => node.type === "input" && node.props.id === id);
  if (!found) throw new Error(`Expected input #${id}`);
  return found.props as Record<string, unknown> & { value: string; onChange?: (event: unknown) => void };
}
function choose(preset: string) { providerSelect(render()).onValueChange(preset); }
function type(id: string, value: string) { field(render(), id).onChange!({ target: { value } }); }
async function submit() {
  harness.fetch.mockResolvedValueOnce(Response.json({ saved: true }));
  const form = elements(render()).find(node => node.type === "form")!;
  (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  await vi.waitFor(() => expect(harness.fetch).toHaveBeenCalledTimes(1));
  const [url, init] = harness.fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/llm/settings");
  expect(init.method).toBe("POST");
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => { harness.state = []; props = { current: null }; vi.clearAllMocks(); vi.stubGlobal("fetch", harness.fetch); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Copilot provider presets on the settings form", () => {
  it("offers the three providers alphabetically, then the custom endpoint", () => {
    const options = elements(render()).filter(node => node.type === "x-select-item" && ["anthropic", "openai", "xai", "custom"].includes(String(node.props.value)));
    expect(options.map(node => node.props.value)).toEqual(["anthropic", "openai", "xai", "custom"]);
    expect(options.map(node => text(node.props.children as ReactNode))).toEqual([
      "Anthropic (Claude)", "OpenAI (ChatGPT models)", "xAI (Grok)", "Custom OpenAI-compatible endpoint"]);
  });

  it("starts on Anthropic with nothing stored and sends the same body as before", async () => {
    const tree = render();
    expect(providerSelect(tree).value).toBe("anthropic");
    expect(elements(tree).some(node => node.props.id === "llm-base-url")).toBe(false);
    expect(text(tree)).toContain(COPILOT_PRESET_GUIDES.anthropic.subscription);
    expect(await submit()).toEqual({ provider: "anthropic", base_url: null, model: DEFAULT_ANTHROPIC_MODEL, api_key: null });
  });

  it.each([
    ["openai", "https://api.openai.com/v1"],
    ["xai", "https://api.x.ai/v1"],
  ] as const)("the %s preset fills the provider and address and leaves the model and key to the person", async (preset, baseUrl) => {
    choose(preset);
    const tree = render();
    expect(providerSelect(tree).value).toBe(preset);
    expect(field(tree, "llm-base-url")).toMatchObject({ value: baseUrl, readOnly: true });
    expect(field(tree, "llm-model")).toMatchObject({ value: "", required: true, placeholder: undefined });
    expect(field(tree, "llm-key")).toMatchObject({ value: "", required: true });
    const shown = text(tree);
    for (const line of Object.values(COPILOT_PRESET_GUIDES[preset])) expect(shown).toContain(line);
    expect(shown).toContain(COPILOT_PRESET_MODEL_HINTS[preset]);
    expect(shown).not.toContain("optional if your provider does not need one");

    type("llm-model", "model-copied-from-list");
    type("llm-key", "synthetic-api-key");
    expect(await submit()).toEqual({ provider: "openai_compatible", base_url: baseUrl,
      model: "model-copied-from-list", api_key: "synthetic-api-key" });
  });

  it("keeps the custom endpoint free-form, and a preset never overwrites its address", async () => {
    choose("openai");
    choose("custom");
    let tree = render();
    expect(field(tree, "llm-base-url")).toMatchObject({ value: "", placeholder: "https://your-provider.example/v1" });
    expect(field(tree, "llm-base-url").readOnly).toBeUndefined();
    expect(field(tree, "llm-model")).toMatchObject({ value: "llama3.1", required: false, placeholder: "llama3.1" });
    expect(field(tree, "llm-key").required).toBe(false);
    expect(text(tree)).toContain("optional if your provider does not need one");
    for (const guide of Object.values(COPILOT_PRESET_GUIDES)) expect(text(tree)).not.toContain(guide.key);

    type("llm-base-url", "https://models.example.test/v1");
    choose("xai");
    expect(field(render(), "llm-base-url").value).toBe("https://api.x.ai/v1");
    choose("custom");
    tree = render();
    expect(field(tree, "llm-base-url").value).toBe("https://models.example.test/v1");
    expect(await submit()).toEqual({ provider: "openai_compatible", base_url: "https://models.example.test/v1",
      model: "llama3.1", api_key: null });
  });

  it("returns to Anthropic with its default model and no address", async () => {
    choose("xai");
    type("llm-model", "typed-for-another-provider");
    choose("anthropic");
    expect(elements(render()).some(node => node.props.id === "llm-base-url")).toBe(false);
    expect(await submit()).toEqual({ provider: "anthropic", base_url: null, model: DEFAULT_ANTHROPIC_MODEL, api_key: null });
  });

  it("reads a stored preset back, keeps its model, and does not ask again for a stored key", async () => {
    props = { current: { provider: "openai_compatible", base_url: "https://api.x.ai/v1", model: "stored-model", key_last4: "wxyz" } };
    const tree = render();
    expect(providerSelect(tree).value).toBe("xai");
    expect(field(tree, "llm-model").value).toBe("stored-model");
    expect(field(tree, "llm-key").required).toBe(false);
    expect(await submit()).toEqual({ provider: "openai_compatible", base_url: "https://api.x.ai/v1", model: "stored-model", api_key: null });
  });

  it("reads any other stored address back as an editable custom endpoint", () => {
    props = { current: { provider: "openai_compatible", base_url: "https://models.example.test/v1", model: "stored-model", key_last4: null } };
    const tree = render();
    expect(providerSelect(tree).value).toBe("custom");
    expect(field(tree, "llm-base-url")).toMatchObject({ value: "https://models.example.test/v1" });
    expect(field(tree, "llm-base-url").readOnly).toBeUndefined();
  });

  it("ignores a value that is not one of its presets", () => {
    providerSelect(render()).onValueChange("openai_compatible");
    expect(providerSelect(render()).value).toBe("anthropic");
    expect(COPILOT_PRESET_NAMES).not.toHaveProperty("openai_compatible");
  });
});
