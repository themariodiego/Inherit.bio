"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COPILOT_PRESET_ADDRESS_HINT,
  COPILOT_PRESET_GUIDE_HEADING,
  COPILOT_PRESET_GUIDES,
  COPILOT_PRESET_MODEL_HINTS,
  COPILOT_PRESET_NAMES,
} from "@/copy/settings/copilot-providers";
import {
  COPILOT_PROVIDER_PRESETS,
  copilotPresetBaseUrl,
  copilotPresetFor,
  copilotPresetTarget,
  isCopilotProviderPreset,
  type CopilotProviderPreset,
} from "@/lib/copilot/provider-presets";
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL } from "@/lib/llm";

export function LlmSettingsForm({
  current,
  localAvailable = false,
}: {
  localAvailable?: boolean;
  current: {
    provider: "anthropic" | "openai_compatible";
    base_url: string | null;
    model: string;
    key_last4: string | null;
  } | null;
}) {
  const router = useRouter();
  // A preset only fills `provider` and `base_url`; the custom endpoint keeps
  // its own typed address, so choosing a preset never overwrites it.
  const [preset, setPreset] = useState<CopilotProviderPreset>(copilotPresetFor(current));
  const [baseUrl, setBaseUrl] = useState(
    current?.base_url ?? (localAvailable ? "http://localhost:11434/v1" : ""),
  );
  const [model, setModel] = useState(
    current?.model ??
      (current?.provider === "openai_compatible" ? "llama3.1" : DEFAULT_ANTHROPIC_MODEL),
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { provider, base_url } = copilotPresetTarget(preset, baseUrl);
  const presetUrl = copilotPresetBaseUrl(preset);
  const guide = preset === "custom" ? null : COPILOT_PRESET_GUIDES[preset];
  const modelHint = preset === "openai" || preset === "xai" ? COPILOT_PRESET_MODEL_HINTS[preset] : null;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
          const res = await fetch("/api/llm/settings", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider,
              base_url,
              model:
                provider === "anthropic" && !ANTHROPIC_MODELS.includes(model as never)
                  ? DEFAULT_ANTHROPIC_MODEL
                  : model,
              api_key: apiKey || null,
            }),
          });
          const result = await res.json().catch(() => ({}));
          setMessage(res.ok ? "Provider saved. Review the separate Copilot permission below." : result.error === "key_required" ? "Enter the API key for this provider before saving." : "Provider could not be saved. Check the address and deployment availability, then try again.");
          router.refresh();
        } catch { setMessage("Could not connect. Try again."); }
        finally { setBusy(false); setApiKey(""); }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="llm-provider">Provider</Label>
        <Select
          value={preset}
          onValueChange={(v) => {
            if (!isCopilotProviderPreset(v)) return;
            setPreset(v);
            // Model names differ between providers and change often, so a
            // named preset starts empty and the person types one.
            setModel(v === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : v === "custom" ? "llama3.1" : "");
          }}
        >
          <SelectTrigger id="llm-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COPILOT_PROVIDER_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {COPILOT_PRESET_NAMES[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset === "custom" ? (
          <p className="text-xs text-ink-muted">
            {localAvailable ? "This server can use the local model addresses set by its owner." : "This server can use external HTTPS providers. It cannot reach a model on your computer."}
          </p>
        ) : null}
        {guide ? (
          <div className="space-y-2 rounded-xl border border-line bg-card p-4 text-sm">
            <p className="font-medium">{COPILOT_PRESET_GUIDE_HEADING}</p>
            <ul className="list-disc space-y-1 pl-5 text-ink-muted">
              <li>{guide.key}</li>
              <li>{guide.spending}</li>
              <li>{guide.subscription}</li>
              <li>{guide.disclosure}</li>
            </ul>
          </div>
        ) : null}
      </div>

      {provider === "openai_compatible" ? (
        <div className="space-y-1.5">
          <Label htmlFor="llm-base-url">Base URL</Label>
          {presetUrl ? (
            <Input id="llm-base-url" value={presetUrl} readOnly aria-describedby="llm-base-url-preset" />
          ) : (
            <Input
              id="llm-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={localAvailable ? "http://localhost:11434/v1" : "https://your-provider.example/v1"}
            />
          )}
          {presetUrl ? (
            <p id="llm-base-url-preset" className="text-xs text-ink-muted">{COPILOT_PRESET_ADDRESS_HINT}</p>
          ) : null}
          <p className="text-xs text-ink-muted">
            The server verifies the destination. Saving does not grant permission to send your information.
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="llm-model">Model</Label>
        {provider === "anthropic" ? (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="llm-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANTHROPIC_MODELS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                  {m === DEFAULT_ANTHROPIC_MODEL ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="llm-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={preset === "custom" ? "llama3.1" : undefined}
            required={preset !== "custom"}
            aria-describedby={modelHint ? "llm-model-hint" : undefined}
          />
        )}
        {modelHint ? (
          <p id="llm-model-hint" className="text-xs text-ink-muted">{modelHint}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-key">
          API key{" "}
          {current?.key_last4 ? (
            <span className="font-normal text-ink-muted">
              (stored, ends …{current.key_last4})
            </span>
          ) : preset === "custom" ? (
            <span className="font-normal text-ink-muted">
              (optional if your provider does not need one)
            </span>
          ) : null}
        </Label>
        <Input
          id="llm-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          required={(preset === "openai" || preset === "xai") && !current?.key_last4}
          placeholder={current?.key_last4 ? "Enter to replace" : "sk-…"}
        />
        <p className="text-xs text-ink-muted">
          We encrypt your key before storing it, using a key held on the server.
          We never log it or show it again. You can delete it below.
        </p>
      </div>

      {message ? <p className="text-sm">{message}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save provider
        </Button>
        {current ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch("/api/llm/settings", { method: "DELETE" });
                setMessage(response.ok ? "Provider and key removed; Copilot permission ended." : "Could not remove the provider. Try again.");
                router.refresh();
              } catch { setMessage("Could not connect. Try again."); }
              finally { setBusy(false); }
            }}
          >
            Remove provider & key
          </Button>
        ) : null}
      </div>
    </form>
  );
}
