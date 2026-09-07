"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LLM_DATA_CLASSES } from "@/lib/llm";
import type { OwnCopilotPermissionView } from "@/lib/copilot/own-consent";

export function OwnCopilotPermission({ view }: { view: OwnCopilotPermissionView }) {
  const router = useRouter();
  const [affirmed, setAffirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (view.kind === "unavailable") return <section className="space-y-2" aria-labelledby="copilot-permission-title">
    <h2 id="copilot-permission-title" className="font-semibold">Copilot permission</h2>
    <p className="text-sm text-ink-muted">Save an available model and complete your own-file permission before enabling Copilot.</p>
    <Link className="text-sm underline" href="/uploads">Your own file</Link>
  </section>;
  const purposeArtifact = view.artifacts.find(a => a.key === `consent.own-copilot-${view.providerClass}`)!;
  return <section className="space-y-4" aria-labelledby="copilot-permission-title">
    <h2 id="copilot-permission-title" className="font-semibold">Copilot permission</h2>
    <p className="text-sm">{view.providerLabel} · {view.model} · {view.origin}</p>
    <p className="text-sm text-ink-muted">{view.providerClass === "local"
      ? "This model runs beside your self-hosted Inherit server."
      : "The information below will be sent to this external provider when you ask Copilot a question."}</p>
    <ul className="list-disc pl-5 text-sm">{LLM_DATA_CLASSES.map(line => <li key={line}>{line}</li>)}</ul>
    <p className="text-sm text-ink-muted">Your original DNA file is not sent. Report types still need their separate permission. Changing the provider, model or key ends this permission.</p>
    {view.artifacts.map(artifact => <details key={artifact.key} className="text-sm">
      <summary className="cursor-pointer underline">{artifact.key === purposeArtifact.key ? "Copilot permission text" : "Cloud disclosure permission text"} · version {artifact.version}</summary>
      <p className="mt-2 whitespace-pre-wrap text-ink-muted">{artifact.body}</p>
    </details>)}
    {view.granted ? <p className="text-sm">Copilot is allowed for this model configuration.</p> : <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={affirmed} onChange={event => setAffirmed(event.target.checked)} />
      <span>I allow this model to use the listed information for my Copilot answers. I can withdraw this permission.</span>
    </label>}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <Button disabled={busy || (!view.granted && !affirmed)} variant={view.granted ? "outline" : "default"} onClick={async () => {
      setBusy(true); setMessage(null);
      try {
        const response = view.granted && view.grantId
          ? await fetch(`/api/consents/${view.grantId}/revoke`, { method: "POST" })
          : await fetch("/api/consents", { method: "POST", headers: { "content-type": "application/json", "x-inherit-csrf": view.token },
            body: JSON.stringify({ action: "grant-purpose", subjectId: view.subjectId, purposeKey: view.purposeKey,
              artifactVersion: purposeArtifact.version, artifactPresentationToken: view.token, affirmed: true,
              statementKeys: ["model-named", "data-classes-named", "raw-file-excluded", "revocable"] }) });
        setMessage(response.ok ? view.granted ? "Permission withdrawn." : "Copilot permission saved." : "Permission could not be updated. Refresh this page and try again.");
        if (response.ok) { setAffirmed(false); router.refresh(); }
      } catch { setMessage("Could not connect. Try again."); }
      finally { setBusy(false); }
    }}>{view.granted ? "Withdraw Copilot permission" : "Allow Copilot for this model"}</Button>
  </section>;
}
