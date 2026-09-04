"use client";

import { createSHA256 } from "hash-wasm";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { REQUEST_DATA_BUTTON } from "@/copy/embryos/index";
import { UPLOAD_H1 } from "@/copy/embryos/upload";
import { INGEST_REFUSALS, SUBJECT_TARGET_REFUSALS } from "@/copy/upload/errors";
import { sniffFileV2 } from "@/lib/genome/parsers/sniff-browser";
import { route } from "@/lib/primary-routes";
import type { FileKind } from "@/lib/genome/types";
import { LIMITS, formatBytes } from "@/lib/limits";
import { createClient } from "@/lib/supabase/client";

const TIER_BY_KIND: Record<FileKind, 1 | 2> = {
  array_23andme: 1,
  array_ancestry: 1,
  array_myheritage: 1,
  array_ftdna: 1,
  vcf: 1,
  gvcf: 1,
  bam: 2,
  cram: 2,
};

function capFor(kind: FileKind): number {
  if (kind === "bam" || kind === "cram") return LIMITS.bamMaxBytes;
  if (kind === "vcf" || kind === "gvcf") return LIMITS.vcfMaxBytes;
  return LIMITS.arrayMaxBytes;
}

type Phase =
  | { step: "idle" }
  | { step: "hashing"; pct: number }
  | { step: "uploading"; pct: number }
  | { step: "registering" }
  | { step: "processing" }
  | { step: "done"; tier: 1 | 2 }
  | { step: "error"; message: string; action?: { label: string; href: string } };

async function sha256Of(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const hasher = await createSHA256();
  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
    read += value.byteLength;
    onProgress(Math.round((read / file.size) * 100));
  }
  return hasher.digest("hex");
}

export function Uploader() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPhase({ step: "error", message: "You are signed out." });
        return;
      }

      // 1. Sniff format from the file head (client-side, before any upload):
      // the browser preflight of every genetic-file flow. A PDF is refused
      // here with the A.6 sentence and the letter, before any byte is sent;
      // a laboratory table or a VCF with several samples is a cohort-shaped
      // source a subject target may not take (the server repeats this at
      // finalization); a file nobody recognises gets the A.6 sentence bound
      // to "sniffV2 null". Every sentence comes from its one home.
      const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
      const sniffed = await sniffFileV2(head);
      if (sniffed.kind === "pdf") {
        setPhase({
          step: "error",
          message: INGEST_REFUSALS.pdf_not_data,
          action: { label: REQUEST_DATA_BUTTON, href: route("embryos.request-data") },
        });
        return;
      }
      if (sniffed.kind === "pgt_table" || sniffed.kind === "vcf_multisample") {
        setPhase({
          step: "error",
          message: SUBJECT_TARGET_REFUSALS.subject_source_not_single_sample,
          action: { label: UPLOAD_H1, href: route("embryos.upload") },
        });
        return;
      }
      if (sniffed.kind === null) {
        setPhase({ step: "error", message: INGEST_REFUSALS.unrecognised_format });
        return;
      }
      const kind: FileKind = sniffed.kind;
      const cap = capFor(kind);
      if (file.size > cap) {
        setPhase({ step: "error", message: INGEST_REFUSALS.too_large(Math.round(cap / (1024 * 1024))) });
        return;
      }

      // 2. Client-side SHA-256 (streamed).
      setPhase({ step: "hashing", pct: 0 });
      const sha256 = await sha256Of(file, (pct) =>
        setPhase({ step: "hashing", pct }),
      );

      // 3. Ask the server for a short-lived, account-bound staging object.
      // The file bytes still travel directly to Supabase Storage.
      const tier = TIER_BY_KIND[kind];
      const issueRes = await fetch("/api/files/upload-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          fileType: kind,
          sizeBytes: file.size,
          sha256,
          contentType: "application/octet-stream",
        }),
      });
      if (!issueRes.ok) throw new Error("Could not authorize this upload.");
      const issued = (await issueRes.json()) as {
        uploadId: string;
        bucketName: string;
        objectName: string;
        tier: 1 | 2;
      };
      if (issued.tier !== tier) throw new Error("Upload tier mismatch.");

      setPhase({ step: "uploading", pct: 0 });
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
          retryDelays: [0, 1000, 3000, 5000, 10000],
          chunkSize: 6 * 1024 * 1024,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: issued.bucketName,
            objectName: issued.objectName,
            contentType: "application/octet-stream",
            cacheControl: "3600",
          },
          headers: { authorization: `Bearer ${session.access_token}` },
          onError: reject,
          onProgress: (sent, total) =>
            setPhase({
              step: "uploading",
              pct: Math.round((sent / total) * 100),
            }),
          onSuccess: () => resolve(),
        });
        upload.findPreviousUploads().then((previous) => {
          if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        });
      });

      // 4. Promote the object and atomically bind its database records.
      setPhase({ step: "registering" });
      const completeRes = await fetch(`/api/files/${issued.uploadId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ originalName: file.name, fileType: kind, tier }),
      });
      if (!completeRes.ok) throw new Error("Could not register the uploaded file.");
      const completed = (await completeRes.json()) as { fileId: string };

      // 5. Tier 1: kick off processing.
      if (tier === 1) {
        setPhase({ step: "processing" });
        const res = await fetch(`/api/files/${completed.fileId}/process`, {
          method: "POST",
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
      }

      setPhase({ step: "done", tier });
      router.refresh();
    } catch (err) {
      setPhase({
        step: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-line bg-card p-6">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        aria-label="Choose a raw DNA file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-medium">Upload raw DNA data</h2>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            23andMe, AncestryDNA, MyHeritage, FamilyTreeDNA, VCF/VCF.GZ and
            gVCF are fully processed (limits {formatBytes(LIMITS.arrayMaxBytes)}
            /{formatBytes(LIMITS.vcfMaxBytes)}). BAM/CRAM up to{" "}
            {formatBytes(LIMITS.bamMaxBytes)} are stored, hashed and
            downloadable; analysis needs the self-host worker. Uploads go
            directly to your private storage with resume support.
          </p>
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={
            phase.step !== "idle" &&
            phase.step !== "done" &&
            phase.step !== "error"
          }
        >
          Choose file
        </Button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {phase.step === "hashing" ? (
          <p>Hashing locally (SHA-256)… {phase.pct}%</p>
        ) : phase.step === "uploading" ? (
          <p>Uploading directly to storage… {phase.pct}%</p>
        ) : phase.step === "registering" ? (
          <p>Registering file…</p>
        ) : phase.step === "processing" ? (
          <p>Parsing and annotating — this can take a couple of minutes…</p>
        ) : phase.step === "done" ? (
          <p className="text-ok">
            {phase.tier === 1
              ? "Processed. Your reports are ready."
              : "Stored and hashed. Analyze it with the self-host worker, or download it any time."}
          </p>
        ) : phase.step === "error" ? (
          <p role="alert" className="text-danger">
            {phase.message}
            {phase.action ? (
              <>
                {" "}
                <Link href={phase.action.href} className="underline underline-offset-2">
                  {phase.action.label}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
