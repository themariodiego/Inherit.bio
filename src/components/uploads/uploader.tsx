"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { REQUEST_DATA_BUTTON } from "@/copy/embryos/index";
import { UPLOAD_H1 } from "@/copy/embryos/upload";
import { INGEST_REFUSALS, SUBJECT_TARGET_REFUSALS } from "@/copy/upload/errors";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import { route } from "@/lib/primary-routes";
import { BrowserPreparationError, BrowserUploadError, prepareSubjectFile, uploadSubjectFile, type UploadProgress } from "@/lib/uploads/subject-upload-browser";

type Phase = UploadProgress | { step: "idle" } | { step: "preparing" | "prepared" | "results-ready"; fileId: string }
  | { step: "preparation-error"; fileId: string; code: "build_unknown" | "unavailable" }
  | { step: "error"; message: string; action?: { label: string; href: string } };

function uploadError(error: unknown): Extract<Phase, { step: "error" }> {
  const code = error instanceof BrowserUploadError ? error.code : "unavailable";
  if (code === "pdf_not_data") return { step: "error", message: INGEST_REFUSALS.pdf_not_data,
    action: { label: REQUEST_DATA_BUTTON, href: route("embryos.request-data") } };
  if (code === "subject_source_not_single_sample") return { step: "error",
    message: SUBJECT_TARGET_REFUSALS.subject_source_not_single_sample,
    action: { label: UPLOAD_H1, href: route("embryos.upload") } };
  const messages = {
    unrecognised_format: INGEST_REFUSALS.unrecognised_format,
    too_large: "This file exceeds the current upload limit for your account.",
    upload_integrity_mismatch: "The uploaded copy did not match your file. Please choose the original file and try again.",
    unauthorized: "You are signed out. Sign in before uploading.",
    uploads_paused: OWN_UPLOAD_COPY.uploadsPaused,
    unavailable: "The upload could not finish. Your existing files are unchanged. Please try again.",
  };
  return { step: "error", message: messages[code] };
}

export function Uploader({ disabled = false, subjectId = "me" }: { disabled?: boolean; subjectId?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const busy = !["idle", "prepared", "results-ready", "preparation-error", "error"].includes(phase.step);
  async function prepare(fileId: string) {
    setPhase({ step: "preparing", fileId });
    try {
      const receipt = await prepareSubjectFile(fileId);
      setPhase({ step: receipt.analysisState === "active" ? "results-ready" : "prepared", fileId });
    } catch (error) {
      setPhase({ step: "preparation-error", fileId,
        code: error instanceof BrowserPreparationError ? error.code : "unavailable" });
    }
    router.refresh();
  }
  async function retryPreparation(fileId: string) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    try { await prepare(fileId); } finally { inFlight.current = false; }
  }
  async function handleFile(file: File) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const receipt = await uploadSubjectFile(file, subjectId, setPhase);
      await prepare(receipt.fileId);
    } catch (error) { setPhase(uploadError(error)); }
    finally {
      inFlight.current = false;
      // Selecting the same original after a failed transfer must fire change.
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  return <div className="rounded-2xl border border-dashed border-line bg-card p-6">
    <input ref={inputRef} type="file" disabled={disabled || busy} className="sr-only"
      aria-hidden tabIndex={-1} aria-label="Choose a raw DNA file"
      onChange={event => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} />
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="font-medium">Upload raw DNA data</h2>
        <p className="mt-1 max-w-md text-sm text-ink-muted">
          Upload a raw file from 23andMe, AncestryDNA, MyHeritage or FamilyTreeDNA,
          or a VCF, VCF.GZ or gVCF file. Files go directly to private storage.
          We check the complete file before saving it. You choose separately which results to make.
        </p>
      </div>
      <Button onClick={() => inputRef.current?.click()} disabled={disabled || busy}>Choose file</Button>
    </div>
    <div aria-live="polite" className="mt-3 text-sm">
      {phase.step === "checking" ? <p>Checking the file format…</p>
        : phase.step === "hashing" ? <p>Checking your file locally… {phase.pct}%</p>
        : phase.step === "uploading" ? <p>Uploading to private storage… {phase.pct}%</p>
        : phase.step === "validating" ? <p>Verifying the complete uploaded file…</p>
        : phase.step === "preparing" ? <p>Your file is stored. Preparing it for your results…</p>
        : phase.step === "prepared" || phase.step === "results-ready" ? <p className="text-ok">
          {phase.step === "results-ready" ? "Your file is stored and your selected reports are ready."
            : "Your file is stored and prepared. Reports have not been generated yet."}{" "}
          <Link href={route("genome.reports", { subject: subjectId === "me" ? "me" : "s-" + subjectId })}
            className="underline underline-offset-2">{phase.step === "results-ready" ? "Explore your reports" : "Choose your reports"}</Link>{" · "}
          <Link href={route("genome.data", { subject: subjectId === "me" ? "me" : "s-" + subjectId })}
            className="underline underline-offset-2">View your file</Link>
        </p>
        : phase.step === "preparation-error" ? <div>
          <p role="alert" className="text-danger">{phase.code === "build_unknown"
            ? "We could not identify the reference genome used in this file. Ask its provider for a VCF or raw DNA file that states GRCh37 or GRCh38."
            : "File preparation did not finish. You can retry this step without uploading your file again."}</p>
          {phase.code === "unavailable" ? <Button className="mt-3" disabled={disabled}
            onClick={() => void retryPreparation(phase.fileId)}>Retry preparation</Button> : null}
        </div>
        : phase.step === "error" ? <p role="alert" className="text-danger">{phase.message}
          {phase.action ? <> <Link href={phase.action.href} className="underline underline-offset-2">{phase.action.label}</Link></> : null}
        </p> : null}
    </div>
  </div>;
}
