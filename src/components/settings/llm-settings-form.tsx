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
import { ANTHROPIC_MODELS } from "@/lib/llm";

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
  const [provider, setProvider] = useState<"anthropic" | "openai_compatible">(
    current?.provider ?? "anthropic",
  );
  const [baseUrl, setBaseUrl] = useState(
    current?.base_url ?? (localAvailable ? "http://localhost:11434/v1" : ""),
  );
  const [model, setModel] = useState(
    current?.model ??
      (current?.provider === "openai_compatible" ? "llama3.1" : "claude-sonnet-5"),
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
              base_url: provider === "openai_compatible" ? baseUrl : null,
              model:
                provider === "anthropic" && !ANTHROPIC_MODELS.includes(model as never)
                  ? "claude-sonnet-5"
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
          value={provider}
          onValueChange={(v) => {
            const p = v as "anthropic" | "openai_compatible";
            setProvider(p);
            setModel(p === "anthropic" ? "claude-sonnet-5" : "llama3.1");
          }}
        >
          <SelectTrigger id="llm-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai_compatible">
              OpenAI-compatible endpoint
            </SelectItem>
            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
          </SelectContent>
        </Select>
        {provider === "openai_compatible" ? (
          <p className="text-xs text-ink-muted">
            {localAvailable ? "This server can use the local model addresses set by its owner." : "This server can use external HTTPS providers. It cannot reach a model on your computer."}
          </p>
        ) : null}
      </div>

      {provider === "openai_compatible" ? (
        <div className="space-y-1.5">
          <Label htmlFor="llm-base-url">Base URL</Label>
          <Input
            id="llm-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={localAvailable ? "http://localhost:11434/v1" : "https://your-provider.example/v1"}
          />
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
                  {m === "claude-sonnet-5" ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="llm-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="llama3.1"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="llm-key">
          API key{" "}
          {current?.key_last4 ? (
            <span className="font-normal text-ink-muted">
              (stored, ends …{current.key_last4})
            </span>
          ) : provider === "openai_compatible" ? (
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
