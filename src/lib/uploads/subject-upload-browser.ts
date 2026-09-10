"use client";

import { createSHA256 } from "hash-wasm";
import { sniffFileV2 } from "../genome/parsers/sniff-browser";
import { route } from "../primary-routes";
import { declaredSubjectFormat, directUploadReceipt, subjectFinalizationReceipt, subjectNormalizationReceipt, subjectProcessingReceipt, subjectReportGenerationFailure, uploadCeilingBytes, uploadSessionBody, type OwnUploadLimits } from "./subject-upload-contract";

export type UploadProgress = { step: "checking" | "hashing" | "uploading" | "validating"; pct: number };
export type UploadFailureCode = "pdf_not_data" | "subject_source_not_single_sample" | "unrecognised_format" |
  "too_large" | "account_full" | "decompressed_too_large" | "upload_integrity_mismatch" | "unauthorized" |
  "uploads_paused" | "unavailable";
export class BrowserUploadError extends Error {
  /** `limitBytes` is set only where the refusing ceiling is known exactly at
   * the throw site. It never crosses the wire; the register forbids unknown
   * response fields, so a server refusal carries its code alone.
   *
   * `stagedUploadId` is set only where the bytes are already in private storage
   * and one more finalization can finish them. It is a local handle for
   * offering that, never a claim that the upload succeeded. */
  constructor(readonly code: UploadFailureCode, readonly limitBytes?: number,
    readonly stagedUploadId?: string) { super(code); }
}
export class BrowserPreparationError extends Error {
  constructor(readonly code: "build_unknown" | "unavailable" | "report_generation_unavailable") { super(code); }
}

/** Preparation is covered by storage consent, not an extra analysis choice.
 * Retry this exact file without uploading its bytes again. */
export async function prepareSubjectFile(fileId: string, options: { signal?: AbortSignal } = {}) {
  if (!subjectNormalizationReceipt.shape.fileId.safeParse(fileId).success) throw new BrowserPreparationError("unavailable");
  const deadline = Date.now() + 3_600_000;
  let jobId: string | undefined;
  for (;;) {
    if (options.signal?.aborted || Date.now() >= deadline) throw new BrowserPreparationError("unavailable");
    const response = await fetch(route("api.file-process", { id: fileId }), {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: options.signal,
    }).catch(() => { throw new BrowserPreparationError("unavailable"); });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const reportFailure = subjectReportGenerationFailure.safeParse(value);
      if (response.status === 503 && reportFailure.success && reportFailure.data.fileId === fileId) {
        throw new BrowserPreparationError("report_generation_unavailable");
      }
      const code = value && typeof value === "object" && "error" in value ? value.error : null;
      throw new BrowserPreparationError(code === "build_unknown" ? "build_unknown" : "unavailable");
    }
    const receipt = subjectProcessingReceipt.safeParse(value);
    if (!receipt.success || receipt.data.fileId !== fileId) throw new BrowserPreparationError("unavailable");
    if (receipt.data.status !== "preparing") {
      if (response.status !== 200) throw new BrowserPreparationError("unavailable");
      return receipt.data;
    }
    if (response.status !== 202 || (jobId && receipt.data.jobId !== jobId)) throw new BrowserPreparationError("unavailable");
    jobId = receipt.data.jobId;
    // Idempotent same-file POST reads current job status; it does not claim a
    // worker or infer success from elapsed time. A queued file is never Prepared.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new BrowserPreparationError("unavailable")); };
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, 2000);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
}
async function responseFailure(response: Response): Promise<never> {
  const value: unknown = await response.json().catch(() => null);
  const code = value && typeof value === "object" && "error" in value ? value.error : null;
  if (response.status === 503 && code === "uploads_paused") throw new BrowserUploadError("uploads_paused");
  if (["pdf_not_data", "subject_source_not_single_sample", "unrecognised_format", "too_large", "account_full",
    "decompressed_too_large", "upload_integrity_mismatch", "unauthorized"].includes(String(code))) {
    throw new BrowserUploadError(code as UploadFailureCode);
  }
  throw new BrowserUploadError(response.status === 401 ? "unauthorized" : "unavailable");
}

/** One ephemeral create-only bearer, no normal auth token, persisted resume
 * fingerprint, filename metadata, background retry or implicit analysis. */
export async function uploadSubjectFile(file: File, subjectId: string, onProgress: (value: UploadProgress) => void,
  limits?: OwnUploadLimits | null) {
  onProgress({ step: "checking", pct: 0 });
  const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  const sniffed = await sniffFileV2(head);
  if (sniffed.kind === "pdf") throw new BrowserUploadError("pdf_not_data");
  if (sniffed.kind === "pgt_table" || sniffed.kind === "vcf_multisample") throw new BrowserUploadError("subject_source_not_single_sample");
  const format = sniffed.kind && declaredSubjectFormat(sniffed.kind, head[0] === 0x1f && head[1] === 0x8b);
  if (!format) throw new BrowserUploadError("unrecognised_format");
  // Refuse a file the deployment cannot accept before reading all of it. The
  // server stays the authority; this only spares a long local hash of bytes
  // that issuance would refuse anyway, and is skipped when limits are unknown.
  const ceiling = limits ? uploadCeilingBytes(format, limits) : undefined;
  if (ceiling !== undefined && file.size > ceiling) throw new BrowserUploadError("too_large", ceiling);
  const hasher = await createSHA256(); let read = 0;
  onProgress({ step: "hashing", pct: 0 });
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      hasher.update(chunk.value); read += chunk.value.length;
      onProgress({ step: "hashing", pct: Math.round(read / file.size * 100) });
    }
  } finally { reader.releaseLock(); }
  const declaration = uploadSessionBody.safeParse({ subjectId, declaredFormat: format, sizeBytes: file.size, sha256: hasher.digest("hex") });
  if (!declaration.success || read !== file.size) throw new BrowserUploadError("unavailable");
  // The public project key routes through Supabase's gateway; it is not the
  // upload authorization. Never substitute a login or server-side credential.
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw new BrowserUploadError("unavailable");
  const response = await fetch(route("api.file-upload-session"), { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(declaration.data), cache: "no-store", redirect: "error" });
  if (response.status !== 201) await responseFailure(response);
  const parsed = directUploadReceipt.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.maximumBytes < file.size || Date.parse(parsed.data.expiresAt) <= Date.now()) {
    throw new BrowserUploadError("unavailable");
  }
  const issued = parsed.data;
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash
    || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)))) {
    throw new BrowserUploadError("unavailable");
  }
  onProgress({ step: "uploading", pct: 0 });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base.origin}/storage/v1/object/genomes/${issued.stagingKey}`);
    xhr.withCredentials = false;
    xhr.timeout = Math.max(1, Date.parse(issued.expiresAt) - Date.now());
    xhr.setRequestHeader("Authorization", `Bearer ${issued.uploadToken}`);
    xhr.setRequestHeader("apikey", apiKey);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    const refuse = () => reject(new BrowserUploadError("unavailable"));
    xhr.onerror = refuse; xhr.ontimeout = refuse; xhr.onabort = refuse;
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : refuse();
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress({ step: "uploading", pct: Math.round(event.loaded / event.total * 100) });
    };
    xhr.send(file);
  });
  onProgress({ step: "validating", pct: 0 });
  return finishStagedUpload(issued.uploadId);
}

/** Statuses the finalize route never answers with, so they come from the edge
 * rather than the application: the request reached no decision at all. A host
 * that kills a long invocation reports it as one of these, or drops the
 * connection, which makes `fetch` reject. Every status the route does answer —
 * 200, 401, 403, 404, 413, 415, 422 and 503 — is its decision and is final,
 * and its 503 has already aborted the upload and removed both objects. */
const NO_DECISION_STATUSES = new Set([408, 502, 504]);

/** Finish an upload whose bytes already reached private storage.
 *
 * The route keeps durable progress for one finalization (ADR-0026), so asking
 * again does only what the interrupted attempt left undone rather than
 * transferring the object a second time. Nothing here decides on its own to
 * ask: a person does, because this uploader performs no background retry and
 * an interrupted upload has to surface its refusal rather than be repeated out
 * of sight.
 *
 * A request that arrives while the previous attempt still holds its lease is
 * refused, deliberately, so that two requests can never drive one
 * finalization. That refusal carries `stagedUploadId` too: the bytes are still
 * there and asking later still works. */
export async function finishStagedUpload(uploadId: string) {
  if (!directUploadReceipt.shape.uploadId.safeParse(uploadId).success) throw new BrowserUploadError("unavailable");
  const staged = (code: UploadFailureCode) => new BrowserUploadError(code, undefined, uploadId);
  const finalized = await fetch(route("api.file-finalize", { id: uploadId }), { method: "POST",
    credentials: "same-origin", cache: "no-store", redirect: "error" }).catch(() => null);
  if (!finalized || NO_DECISION_STATUSES.has(finalized.status)) throw staged("unavailable");
  // A refusal that names the upload rather than the file leaves the bytes
  // where they are; every other refusal has already cleaned them up.
  if (finalized.status === 404) throw staged("unavailable");
  if (!finalized.ok) await responseFailure(finalized);
  const receipt = subjectFinalizationReceipt.safeParse(await finalized.json().catch(() => null));
  if (!receipt.success) throw new BrowserUploadError("unavailable");
  return receipt.data;
}
