"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OTHER_ADULT_UPLOAD_COPY as COPY, REVIEWED_DOCUMENT_COPY as DOCUMENT } from "@/copy/upload/other-adult";
import { sniffDocumentType } from "@/lib/future-person/document-sniff";
import { route } from "@/lib/primary-routes";
import { otherAdultTypedNameIsValid, type ReviewedDocumentTarget } from "@/lib/uploads/other-adult-upload";
import { day } from "./other-adult-lines";
import { ConsentFields } from "./other-adult-upload-card";

type DocumentStatus = keyof typeof DOCUMENT.documentStatus;
const MAXIMUM_BYTES = 20_000_000;
const CHUNK_BYTES = 4_000_000;
const POLLS = 60;
const REFUSAL: Record<string, DocumentStatus> = {
  integrity: "integrity", type: "type", expired: "expired", infected: "malware", unscannable: "unscannable",
  oversize: "oversize", storage: "failed",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * One reviewed-document Path B person of the signed-in uploader, with the one
 * thing that can be done now: sign the uploader permission, send the
 * document the person signed (api.legal-evidence-upload-session, then the
 * bounded api.evidence-chunk and api.evidence-complete doors), wait for the
 * named review, or send the request (api.subjects). The browser never learns
 * a bucket, a key, a reviewer or whether the address is barred.
 */
export function ReviewedDocumentCard({ target }: { target: ReviewedDocumentTarget }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<DocumentStatus | null>(null);

  const card = (children: ReactNode, slot: string) => <article className="surface surface-pad rec-stack" data-slot={slot}>
    <h3 className="title">{target.label} · {COPY.requestedOn(day(target.requestedAt))}</h3>{children}
  </article>;
  const line = (text: string, slot: string) => card(<p role="status" className="max-w-measure text-sm">{text}</p>, slot);

  if (target.blockedBy) {
    return line(target.blockedBy === "account-completion" ? COPY.accountFirstStatus : COPY.unavailableStatus, "reviewed-document-blocked");
  }
  if (target.state === "document-review") return line(DOCUMENT.reviewStatus(target.label), "reviewed-document-review");
  if (target.state === "document-refused") return line(DOCUMENT.refusedStatus(target.label), "reviewed-document-refused");
  if (target.state === "awaiting-signature") {
    return line(COPY.awaitingSignature(target.label, day(target.answerBy)), "reviewed-document-awaiting");
  }

  const consent = target.consent;
  if (target.state === "awaiting-document" && consent) {
    const ready = consent.statements.every((statement) => checked[statement.key]) && typedName.trim().length > 0;
    async function sign() {
      if (!otherAdultTypedNameIsValid(typedName)) { setNameError(true); return; }
      setBusy(true); setFailed(false);
      try {
        const response = await fetch(route("api.consents"), {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", "x-inherit-csrf": consent!.token },
          body: JSON.stringify({
            action: "sign-artifact", signatureClass: "tier2", subjectDraftId: target.subjectId,
            artifactVersion: consent!.version, artifactPresentationToken: consent!.token, affirmed: true,
            statementKeys: consent!.statements.map((statement) => statement.key), typedName: typedName.trim(),
          }),
        });
        // Read to the end, so no response is left open behind the refresh.
        await response.arrayBuffer().catch(() => null);
        if (response.status !== 201) throw new Error("not_signed");
        router.refresh();
      } catch { setFailed(true); setBusy(false); }
    }
    // No native form: the one action is this button's handler, so nothing
    // here can submit without the handler's own checks.
    return card(<div className="rec-stack">
      <ConsentFields consent={consent} checked={checked} setChecked={setChecked} typedName={typedName}
        setTypedName={setTypedName} nameError={nameError} setNameError={setNameError} id={target.subjectId} />
      <p className="max-w-measure text-base">{consent.warning}</p>
      {failed ? <p role="alert" className="text-sm text-danger">{COPY.signFailed}</p> : null}
      <div><Button type="button" disabled={!ready || busy} onClick={() => void sign()}>{busy ? COPY.saving : COPY.signButton}</Button></div>
    </div>, "reviewed-document-sign");
  }

  if (target.state === "awaiting-document" && target.documentToken) {
    const token = target.documentToken;
    async function send() {
      const file = input.current?.files?.[0];
      if (!file) return;
      setBusy(true); setStatus("working");
      try {
        if (file.size < 1 || file.size > MAXIMUM_BYTES) return setStatus("oversize");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mediaType = sniffDocumentType(bytes);
        if (!mediaType) return setStatus("type");
        const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
        const opened = await fetch("/api/legal-evidence/upload-session", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", "x-inherit-csrf": token },
          body: JSON.stringify({ documentKind: "adult-signed-permission", subjectDraftId: target.subjectId, mediaType,
            sizeBytes: bytes.length, sha256 }),
        });
        if (opened.status === 422) {
          const issues = ((await opened.json().catch(() => null)) as { issues?: unknown } | null)?.issues;
          return setStatus(Array.isArray(issues) && issues.includes("capacity") ? "limited" : "failed");
        }
        if (opened.status === 403 || opened.status === 404) return setStatus("expired");
        if (opened.status !== 201) return setStatus("failed");
        const session = ((await opened.json()) as { session: string }).session;
        const csrf = opened.headers.get("x-inherit-csrf") ?? "";
        const completeNonce = opened.headers.get("x-inherit-complete-nonce") ?? "";
        const chunkCount = Math.ceil(bytes.length / CHUNK_BYTES);
        for (let sequence = 0; sequence < chunkCount; sequence++) {
          const sent = await fetch(`/api/evidence/${session}/chunks/${sequence}`, {
            method: "PUT", credentials: "same-origin", cache: "no-store",
            headers: { "content-type": "application/octet-stream", "x-inherit-csrf": csrf },
            body: bytes.slice(sequence * CHUNK_BYTES, (sequence + 1) * CHUNK_BYTES),
          });
          if (sent.status !== 204) return setStatus(sent.status === 404 ? "expired" : "integrity");
        }
        for (let poll = 0; poll < POLLS; poll++) {
          const done = await fetch(`/api/evidence/${session}/complete`, {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
            body: JSON.stringify({ chunkCount, nonce: completeNonce }),
          });
          if (done.status === 201) { setStatus("received"); router.refresh(); return; }
          if (done.status === 422) {
            const reason = ((await done.json().catch(() => null)) as { reason?: string } | null)?.reason;
            return setStatus(reason ? REFUSAL[reason] ?? "failed" : "failed");
          }
          await done.arrayBuffer().catch(() => null);
          if (done.status !== 202) return setStatus(done.status === 404 ? "expired" : "failed");
          setStatus("scanning");
          await wait(3000);
        }
        setStatus("failed");
      } catch { setStatus("failed"); }
      finally { setBusy(false); }
    }
    const inputId = `reviewed-document-${target.subjectId}`;
    return card(<>
      <h4 className="title">{DOCUMENT.documentHeading}</h4>
      <p className="max-w-measure text-sm text-ink-muted">{DOCUMENT.documentDetail}</p>
      <div className="rec-field">
        <Label htmlFor={inputId}>{DOCUMENT.documentLabel}</Label>
        <input id={inputId} ref={input} type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy}
          className="block min-h-11 w-full text-sm" data-slot="reviewed-document-file" />
      </div>
      <div><Button type="button" disabled={busy} onClick={() => void send()}>
        {status === "working" || status === "scanning" ? DOCUMENT.documentStatus[status] : DOCUMENT.documentButton}
      </Button></div>
      <div aria-live="polite">
        {status && status !== "working" ? <p role="status" className="max-w-measure text-sm">{DOCUMENT.documentStatus[status]}</p> : null}
      </div>
    </>, "reviewed-document-upload");
  }

  if (target.state === "awaiting-request" && target.finalize && target.documentId && target.legalReviewId) {
    const { nonce, csrf } = target.finalize;
    const documentId = target.documentId, legalReviewId = target.legalReviewId;
    async function request() {
      setBusy(true); setFailed(false);
      try {
        const response = await fetch("/api/subjects", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", "x-inherit-csrf": csrf },
          body: JSON.stringify({ subjectDraftId: target.subjectId, permissionEvidenceDocumentId: documentId,
            legalReviewId, nonce }),
        });
        // subject-created-v1 is the same for every address; anything else is a failure.
        const receipt = (await response.json().catch(() => null)) as { status?: unknown; next?: unknown } | null;
        if (response.status !== 202 || receipt?.status !== "received" || receipt.next !== "awaiting_subject_confirmation") {
          throw new Error("not_sent");
        }
        router.refresh();
      } catch { setFailed(true); setBusy(false); }
    }
    return card(<>
      <p className="max-w-measure text-sm">{DOCUMENT.requestDetail(target.label)}</p>
      <p className="max-w-measure text-sm text-ink-muted">{DOCUMENT.requestEnds(day(target.answerBy))}</p>
      {failed ? <p role="alert" className="text-sm text-danger">{DOCUMENT.requestFailed}</p> : null}
      <div><Button type="button" disabled={busy} onClick={() => void request()}>
        {busy ? COPY.saving : DOCUMENT.requestButton}</Button></div>
    </>, "reviewed-document-request");
  }

  return line(COPY.unavailableStatus, "reviewed-document-unavailable");
}
