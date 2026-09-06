"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { OwnReportChoicesView } from "@/lib/uploads/own-report-purpose";
import { disableOwnReportChoice, enableOwnReportChoice, generateOwnReports } from "@/lib/uploads/own-report-choice-browser";

type View = Extract<OwnReportChoicesView, { kind: "ready" }>;
type Choice = View["choices"][number];

function ReportChoice({ choice, subjectId, onSaved }: {
  choice: Choice; subjectId: string; onSaved: (message: string) => void;
}) {
  const [affirmed, setAffirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current || (!choice.granted && !affirmed)) return;
    inFlight.current = true; setPending(true); setError(false);
    try {
      if (choice.granted && choice.grantId) await disableOwnReportChoice(choice.grantId);
      else await enableOwnReportChoice(subjectId, choice);
      onSaved(choice.granted ? `${choice.label} turned off. Your original file is kept.`
        : choice.purposeKey === "ancestry" ? "Ancestry choice saved. Ancestry generation for new uploads is not available yet."
        : `${choice.label} enabled. You can now generate your selected reports.`);
      // The refreshed presentation has a new token/key. Keep this consumed
      // presentation disabled until its authoritative replacement arrives.
    } catch { setError(true); setAffirmed(false); inFlight.current = false; setPending(false); }
  }
  return <div className="space-y-3 rounded-xl border border-line p-4">
    <h3 className="font-medium">{choice.label} <span className="text-sm text-ink-muted">· {choice.granted ? "On" : "Off"}</span></h3>
    <p className="text-sm text-ink-muted">{choice.description}</p>
    {choice.purposeKey === "ancestry" ? <p className="text-sm text-ink-muted">Ancestry generation for new uploads is not available yet. This choice does not generate an ancestry result.</p> : null}
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-3 underline underline-offset-2">Permission details · version {choice.artifact.version}</summary>
      <div className="whitespace-pre-wrap leading-relaxed">{choice.artifact.body}</div>
    </details>
    {!choice.granted ? <label className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" className="size-5" aria-label={choice.label} checked={affirmed} disabled={pending}
        onChange={event => setAffirmed(event.target.checked)} />
      <span>I want Inherit to make these results for me.</span>
    </label> : null}
    <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal text-left" disabled={pending || (!choice.granted && !affirmed)} onClick={() => void save()}>
      {pending ? "Saving…" : `${choice.granted ? "Turn off" : "Enable"} ${choice.label}`}
    </Button>
    {error ? <p role="alert" className="text-sm text-danger">We could not confirm your choice. Refresh the page to check its current state before trying again.</p> : null}
  </div>;
}

export function OwnReportChoices({ view, files }: { view: View; files: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selectedFile = files.some(file => file.id === fileId) ? fileId : files[0]?.id;
  const canGenerate = view.choices.some(choice => choice.granted && choice.purposeKey !== "ancestry");
  const orderedChoices = [...view.choices].sort((a, b) =>
    Number(b.purposeKey === "reports.polygenic") - Number(a.purposeKey === "reports.polygenic"));
  async function generate() {
    if (inFlight.current || !selectedFile || !canGenerate) return;
    inFlight.current = true; setPending(true); setMessage(""); setError("");
    try {
      const state = await generateOwnReports(selectedFile);
      setMessage(state === "ready" ? "Your selected reports are ready. Explore your results below."
        : "Your file is prepared, but no selected reports were generated. Check your report choices and try again.");
      router.refresh();
    } catch { setError("Report generation did not finish. Your file is still stored. You can retry without uploading it again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section aria-labelledby="own-report-choices-title" className="space-y-4 rounded-2xl border border-line bg-card p-5">
    <h2 id="own-report-choices-title" className="display text-2xl">Choose your reports</h2>
    <p className="max-w-prose text-sm text-ink-muted">Start with trait reports to explore findings from your file. Each choice is independent; you do not need to enable everything. You can turn a choice off here later.</p>
    <div className="grid gap-4 md:grid-cols-3">{orderedChoices.map(choice => <ReportChoice
      key={`${choice.purposeKey}:${choice.grantId}:${choice.token}`} choice={choice} subjectId={view.subjectId}
      onSaved={text => { setMessage(text); setError(""); router.refresh(); }} />)}</div>
    {files.length > 1 ? <label className="block space-y-2 text-sm"><span>File to use</span>
      <select className="min-h-11 w-full rounded-lg border border-line bg-card px-3" value={selectedFile} disabled={pending}
        onChange={event => setFileId(event.target.value)}>{files.map(file => <option key={file.id} value={file.id}>{file.label}</option>)}</select>
    </label> : null}
    <Button disabled={!canGenerate || !selectedFile || pending} onClick={() => void generate()}>{pending ? "Generating your selected reports…" : "Generate selected reports"}</Button>
    {!canGenerate ? <p className="text-sm text-ink-muted">Enable a report type above to get started. Your file stays stored even if every choice is off.</p> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </section>;
}
