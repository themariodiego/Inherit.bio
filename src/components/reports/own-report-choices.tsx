"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { route } from "@/lib/primary-routes";
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
        : `${choice.label} enabled. You can now generate your selected reports.`);
      // The refreshed presentation has a new token/key. Keep this consumed
      // presentation disabled until its authoritative replacement arrives.
    } catch { setError(true); setAffirmed(false); inFlight.current = false; setPending(false); }
  }
  // One surface per choice: label and state, what it does, the permission
  // text, the affirmation row on the control scale, then the one action.
  return <div className="surface surface-pad flex flex-col gap-4">
    <h3 className="title text-ink">{choice.label} <span className="text-sm font-normal text-ink-muted">· {choice.granted ? "On" : "Off"}</span></h3>
    <p className="text-sm leading-relaxed text-ink">{choice.description}</p>
    {choice.purposeKey === "ancestry" ? <p className="text-sm leading-relaxed text-ink">Compares your file with seven broad reference regions. Some regions are combined when the panel cannot tell them apart. Parent lines are checked where your file has usable positions.</p> : null}
    <details className="text-sm">
      <summary className="quiet-link w-fit">Permission details · version {choice.artifact.version}</summary>
      <div className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{choice.artifact.body}</div>
    </details>
    {!choice.granted && choice.reconsent ? <div data-testid="reconsent-notice"
      data-purpose={choice.purposeKey} data-signed-version={choice.reconsent.signedVersion}
      className="surface-tint surface-pad-sm space-y-2 text-sm text-ink">
      <p className="font-medium">You agreed to version {choice.reconsent.signedVersion}. This permission has changed since then, so it is off until you agree again.</p>
      {choice.reconsent.changes.map(change => <p key={change.version} data-testid="reconsent-change" data-version={change.version}>
        <span className="text-ink-muted">What changed in version {change.version}:</span> {change.summary}
      </p>)}
      <a data-testid="reconsent-previous" className="link-target prose-link"
        href={`/legal/consent/${choice.artifact.key}/v/${choice.reconsent.signedVersion}`}>
        Read version {choice.reconsent.signedVersion} in full
      </a>
    </div> : null}
    {!choice.granted ? <label className="flex min-h-control cursor-pointer items-center gap-3 text-sm text-ink">
      <input type="checkbox" className="size-5 accent-forest" aria-label={choice.label} checked={affirmed} disabled={pending}
        onChange={event => setAffirmed(event.target.checked)} />
      <span>I want Inherit to make these results for me.</span>
    </label> : null}
    <Button type="button" variant="outline" className="self-start" disabled={pending || (!choice.granted && !affirmed)} onClick={() => void save()}>
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
  const canGenerate = view.choices.some(choice => choice.granted);
  const ancestrySelected = view.choices.some(choice => choice.granted && choice.purposeKey === "ancestry");
  const orderedChoices = [...view.choices].sort((a, b) =>
    Number(b.purposeKey === "reports.polygenic") - Number(a.purposeKey === "reports.polygenic"));
  async function generate() {
    if (inFlight.current || !selectedFile || !canGenerate) return;
    inFlight.current = true; setPending(true); setMessage(""); setError("");
    try {
      const state = await generateOwnReports(selectedFile);
      setMessage(state === "ready" ? ancestrySelected
        ? "Your selected results are ready. Your ancestry result is on the ancestry page."
        : "Your selected reports are ready. Explore your results below."
        : "Your file is prepared, but no selected reports were generated. Check your report choices and try again.");
      router.refresh();
    } catch { setError("Report generation did not finish. Your file is still stored. You can retry without uploading it again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  // The panel is not itself a box: the choices are the surfaces, and the
  // page's one primary action generates them.
  return <section aria-labelledby="own-report-choices-title" className="space-y-6">
    <div className="space-y-3">
      <h2 id="own-report-choices-title" className="display text-ink">Choose your reports</h2>
      <p className="max-w-measure text-ink-muted">Start with trait reports to explore findings from your file. Each choice is independent; you do not need to enable everything. You can turn a choice off here later.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{orderedChoices.map(choice => <ReportChoice
      key={`${choice.purposeKey}:${choice.grantId}:${choice.token}`} choice={choice} subjectId={view.subjectId}
      onSaved={text => { setMessage(text); setError(""); router.refresh(); }} />)}</div>
    {files.length > 1 ? <label className="block max-w-md space-y-2 text-sm"><span className="label text-ink">File to use</span>
      <select className="h-11 w-full rounded-sm border border-line-strong bg-card px-3.5 text-base text-ink" value={selectedFile} disabled={pending}
        onChange={event => setFileId(event.target.value)}>{files.map(file => <option key={file.id} value={file.id}>{file.label}</option>)}</select>
    </label> : null}
    <Button disabled={!canGenerate || !selectedFile || pending} onClick={() => void generate()}>{pending ? "Generating your selected reports…" : "Generate selected reports"}</Button>
    {ancestrySelected ? <p className="text-sm"><Link className="link-target prose-link" href={route("genome.ancestry", { subject: "me" })}>View ancestry</Link></p> : null}
    {!canGenerate ? <p className="max-w-measure text-sm text-ink-muted">Enable a report type above to get started. Your file stays stored even if every choice is off.</p> : null}
    {message ? <p role="status" className="max-w-measure text-sm text-ink">{message}</p> : null}
    {error ? <p role="alert" className="max-w-measure text-sm text-danger">{error}</p> : null}
  </section>;
}
