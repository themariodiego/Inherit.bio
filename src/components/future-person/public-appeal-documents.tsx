"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sniffDocumentType } from "@/lib/future-person/document-sniff";
import type { PublicAppealView } from "@/lib/future-person/public-appeal-session";
const LABELS = {
 "appeal-photo-identity": "Photo identity document", "appeal-subject-source-control": "Evidence that the source is yours",
 "appeal-genetic-parent-authority": "Evidence of your genetic parent role", "appeal-decision-notice": "The decision notice",
 "appeal-contradiction-counterevidence": "Evidence about the original decision",
} as const;
type Kind = keyof typeof LABELS;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
/** One current case, no target selector or match disclosure. Files never enter
 * browser persistence, a URL, telemetry, or an error message. */
export function PublicAppealDocuments({ view, documentNonce, completeNonce, documentCsrf, completeCsrf }: {
 view: PublicAppealView; documentNonce: string; completeNonce: string; documentCsrf: string; completeCsrf: string;
}) {
 const router = useRouter(); const inputs = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});
 const [ids, setIds] = useState<Partial<Record<Kind, string>>>(() => Object.fromEntries(view.documents.map(document => [document.documentKind, document.documentId]))); const [messages, setMessages] = useState<Partial<Record<Kind, string>>>({});
 const [busy, setBusy] = useState(false); const [affirmed, setAffirmed] = useState(false); const [finished, setFinished] = useState(false);
 const [failure, setFailure] = useState(false);
 const [notices, setNotices] = useState<{ documentKind: string; decision: string; decisionReference: string | null }[]>([]);
 async function readNotice() {
  setBusy(true); setFailure(false);
  try { const answer = await fetch("/api/appeals/session/decision", { credentials: "same-origin", cache: "no-store" });
   if (answer.status !== 200) throw new Error("unavailable"); const raw: unknown = await answer.json();
   if (!raw || typeof raw !== "object" || !("decisions" in raw) || !Array.isArray(raw.decisions)) throw new Error("unavailable");
   const rows = raw.decisions as Record<string, unknown>[];
   if (rows.some(row => !row || Object.keys(row).sort().join("|") !== "decision|decisionReference|documentKind"
    || typeof row.documentKind !== "string" || !view.documentKinds.includes(row.documentKind as Kind) || !["approved", "rejected"].includes(String(row.decision))
    || !(row.decisionReference === null || typeof row.decisionReference === "string" && /^[0-9a-f]{48}$/u.test(row.decisionReference)))) throw new Error("unavailable");
   setNotices(rows as typeof notices);
  } catch { setFailure(true); } finally { setBusy(false); }
 }
 async function send(kind: Kind) {
  const file = inputs.current[kind]?.files?.[0]; if (!file || busy) return;
  let bytes: Uint8Array<ArrayBuffer> | null = null; setBusy(true); setMessages(old => ({ ...old, [kind]: "Sending your document…" }));
  try {
   if (file.size < 1 || file.size > 20_000_000) throw new Error("document_unavailable");
   bytes = new Uint8Array(await file.arrayBuffer()); const mediaType = sniffDocumentType(bytes); if (!mediaType) throw new Error("document_unavailable");
   const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
   const opened = await fetch("/api/appeals/session/documents", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-inherit-csrf": documentCsrf, "x-inherit-operation-nonce": documentNonce },
    body: JSON.stringify({ documentKind: kind, mediaType, sizeBytes: bytes.length, sha256 }) });
   router.refresh(); if (opened.status !== 201) throw new Error("document_unavailable");
   const value: unknown = await opened.json();
   if (typeof value !== "object" || value === null || !("session" in value) || typeof value.session !== "string"
    || !/^[0-9a-f-]{36}$/u.test(value.session)) throw new Error("document_unavailable");
   const session = value.session; const csrf = opened.headers.get("x-inherit-csrf"); const nonce = opened.headers.get("x-inherit-complete-nonce");
   if (!csrf || !nonce) throw new Error("document_unavailable");
   const chunkCount = Math.ceil(bytes.length / 4_000_000);
   for (let sequence = 0; sequence < chunkCount; sequence++) {
    const chunk = bytes.slice(sequence * 4_000_000, (sequence + 1) * 4_000_000);
    try { const answer = await fetch(`/api/evidence/${session}/chunks/${sequence}`, { method: "PUT", credentials: "same-origin",
     headers: { "content-type": "application/octet-stream", "x-inherit-csrf": csrf }, body: chunk });
     if (answer.status !== 204) throw new Error("document_unavailable");
    } finally { chunk.fill(0); }
   }
   for (let poll = 0; poll < 60; poll++) {
    const answer = await fetch(`/api/evidence/${session}/complete`, { method: "POST", credentials: "same-origin",
     headers: { "content-type": "application/json", "x-inherit-csrf": csrf }, body: JSON.stringify({ chunkCount, nonce }) });
    if (answer.status === 201) {
     const result: unknown = await answer.json();
     if (typeof result !== "object" || result === null || !("documentId" in result) || typeof result.documentId !== "string"
      || !("documentKind" in result) || result.documentKind !== kind || !("status" in result) || result.status !== "review_pending") throw new Error("document_unavailable");
     setIds(old => ({ ...old, [kind]: result.documentId as string })); setMessages(old => ({ ...old, [kind]: "Document received for review." })); return;
    }
    if (answer.status !== 202) throw new Error("document_unavailable");
    setMessages(old => ({ ...old, [kind]: "Checking your document…" })); await new Promise(resolve => setTimeout(resolve, 3000));
   }
   throw new Error("document_unavailable");
  } catch { setMessages(old => ({ ...old, [kind]: "This document could not be received. Please try again." })); }
  finally { bytes?.fill(0); if (inputs.current[kind]) inputs.current[kind]!.value = ""; setBusy(false); }
 }
 async function finish() {
  if (!view.completionAvailable || !affirmed || !view.documentKinds.every(kind => ids[kind]) || busy) return;
  setBusy(true); setFailure(false);
  const authority = view.documentKinds.includes("appeal-subject-source-control")
   ? { subjectSourceControlDocumentId: ids["appeal-subject-source-control"] }
   : { geneticParentAuthorityDocumentId: ids["appeal-genetic-parent-authority"] };
  try { const answer = await fetch("/api/appeals/session/complete", { method: "POST", credentials: "same-origin",
   headers: { "content-type": "application/json", "x-inherit-csrf": completeCsrf },
   body: JSON.stringify({ photoIdentityDocumentId: ids["appeal-photo-identity"], ...authority, ...(view.caseKind === "access-or-review-appeal" ? { decisionNoticeDocumentId: ids["appeal-decision-notice"] } : {}), affirmed: true, nonce: completeNonce }) });
   if (answer.status !== 202) throw new Error("appeal_unavailable");
   const result: unknown = await answer.json();
   if (typeof result !== "object" || result === null || !("status" in result) || result.status !== "review_pending") throw new Error("appeal_unavailable");
   setFinished(true);
  } catch { setFailure(true); } finally { setBusy(false); }
 }
 if (finished) return <section className="mx-auto max-w-3xl px-6 py-section"><h1 className="display display-lg">Your files were sent</h1>
  <p className="mt-6">A named reviewer will review your request. This does not grant access or decide the outcome.</p>
  <p className="mt-4">Your request keeps its original deadline: {new Date(view.deadline).toLocaleDateString("en-GB", { timeZone: "UTC" })}.</p>
  <Button type="button" onClick={() => void readNotice()} disabled={busy}>Check review</Button>
  {notices.map((notice, index) => <div key={index} className="mt-4"><p>{LABELS[notice.documentKind as Kind]}: {notice.decision === "approved" ? "approved" : "refused"}.</p>
   {notice.decisionReference && <><p>Keep this reference if you ask for a review of this decision:</p><code>{notice.decisionReference}</code></>}
  </div>)}
  {failure && <p role="status">This private session is not available. No new link or access has been created.</p>}
 </section>;
 return <section className="mx-auto max-w-3xl px-6 py-section"><h1 className="display display-lg">Files for your request</h1>
  {view.informationRequested && <p className="mt-4">You were asked for more files for this same request. Its original deadline has not changed.</p>}
  <p className="mt-6">These documents are used only to review your request. They do not give you access to a record.</p>
  <p className="mt-3">Original deadline: {new Date(view.deadline).toLocaleDateString("en-GB", { timeZone: "UTC" })}.</p>
  <div className="mt-8 space-y-8">{view.documentKinds.map(kind => <div key={kind} className="space-y-3">
   <label htmlFor={`appeal-${kind}`} className="block font-medium">{LABELS[kind]}</label>
   <input id={`appeal-${kind}`} ref={element => { inputs.current[kind] = element; }} type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy}
    aria-describedby={`appeal-${kind}-hint`} className="block min-h-11 w-full text-sm" />
   <p id={`appeal-${kind}-hint`} className="text-sm text-ink-muted">PDF, JPEG or PNG. Maximum 20 MB. The original filename is not sent.</p>
   <Button type="button" disabled={busy} onClick={() => void send(kind)}>Send file</Button>
   {messages[kind] && <p role="status">{messages[kind]}</p>}
  </div>)}</div>
  {view.completionAvailable ? <div className="mt-8 space-y-4"><label className="flex min-h-11 gap-3"><input type="checkbox" checked={affirmed}
   onChange={event => setAffirmed(event.target.checked)} /><span>I confirm these files show why I ask for this review.</span></label>
   <Button type="button" onClick={() => void finish()} disabled={busy || !affirmed || !view.documentKinds.every(kind => ids[kind])}>Send for review</Button>
   {failure && <p role="alert">Your evidence could not be submitted. Please reopen your request.</p>}
  </div> : <p className="mt-8">The underlying decision must be identified before this evidence set can be completed.</p>}
 </section>;
}
