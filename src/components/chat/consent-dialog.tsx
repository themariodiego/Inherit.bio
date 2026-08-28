"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LLM_DATA_CLASSES, providerDisplayName } from "@/lib/llm";
import { createClient } from "@/lib/supabase/client";

// The cloud-consent gate (A9): names the provider and the exact data classes
// before any genome-derived data leaves for a cloud LLM. Grants are stored
// and revocable in Settings.
export function ConsentDialog({
  providerKey,
  open,
  onGranted,
  onCancel,
}: {
  providerKey: string;
  open: boolean;
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Send genome-derived data to {providerDisplayName(providerKey)}?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-sm">
              <p>
                To answer questions about your DNA, the copilot would send the
                following data classes to{" "}
                <strong>{providerDisplayName(providerKey)}</strong>, a cloud
                provider outside this deployment:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {LLM_DATA_CLASSES.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>
                Your raw file is never sent — only the specific values the
                copilot looks up for your questions. The provider processes
                them under its own terms. You can revoke this grant any time
                in Settings; revoking stops all future sending immediately.
              </p>
              <p>
                Prefer nothing to leave your machine? Point the copilot at a
                local model (Ollama, LM Studio) in Settings instead.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            data-testid="consent-grant"
            onClick={async () => {
              setBusy(true);
              setError(null);
              const supabase = createClient();
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) {
                setError("Signed out.");
                setBusy(false);
                return;
              }
              const { error: insertError } = await supabase
                .from("consent_grants")
                .insert({
                  user_id: user.id,
                  provider_key: providerKey,
                  data_classes: [...LLM_DATA_CLASSES],
                });
              setBusy(false);
              if (insertError) {
                setError(insertError.message);
                return;
              }
              onGranted();
            }}
          >
            I consent — enable {providerDisplayName(providerKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
