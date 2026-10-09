"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ReviewPdfDocument } from "./review-pdf";
import { readReviewDocument } from "@/lib/future-person/read-review-document";
import { z } from "zod";
const document = z.object({ documentId: z.uuid(), kind: z.enum(["appeal-photo-identity", "appeal-subject-source-control", "appeal-genetic-parent-authority", "appeal-decision-notice"]),
 reviewState: z.enum(["pending", "approved", "rejected"]), evidenceRevision: z.number().int().positive() }).strict();
const row = z.object({ caseId: z.uuid(), kind: z.enum(["subject-objection", "genetic-parent-objection", "access-or-review-appeal"]),
 submittedAt: z.iso.datetime({ offset: true }), claimantName: z.string(), contactEmail: z.email(),
 reference: z.object({ kind: z.enum(["subject", "cohort", "decision", "none"]), value: z.string().nullable() }).strict(), statement: z.string(),
 targetBinding: z.object({ state: z.literal("unresolved"), kind: z.literal("none"), safeReference: z.null(), targetRevision: z.null(), principalRevision: z.null(),
  contradictionRevision: z.null(), suspensionRevision: z.null(), nonOverturnedCountRevision: z.null(), counterevidenceRevision: z.null() }).strict(),
 contradictionOverturnPackage: z.object({ state: z.literal("not_applicable"), allowedGround: z.literal("none"), originalTriggerProvenanceLocked: z.literal(false), counterevidenceRevision: z.null() }).strict(),
 evidence: z.array(document).min(2).max(3), reviewRevision: z.number().int().positive(), deadline: z.iso.datetime({ offset: true }),
}).strict();
const controls = z.record(z.uuid(), z.object({ receipt: z.string().min(1).max(2048), decision: z.string().min(1).max(2048) }).strict());
const names = { "appeal-photo-identity": "Photo identity document", "appeal-subject-source-control": "Evidence that the source is yours",
 "appeal-genetic-parent-authority": "Evidence of your genetic parent role", "appeal-decision-notice": "The decision notice" };
type View = { documentId: string; url: string; media: string; sha256: string; rendered: boolean };
/** The assigned reviewer reads a whole hash-verified document and explicitly
 * judges that document. This UI has no automatic target or access approval. */
export function PublicAppealReview({ caseId }: { caseId: string }) {
 const [loaded, setLoaded] = useState<{ value: z.infer<typeof row>; csrf: string; controls: z.infer<typeof controls> } | null>(null);
 const [view, setView] = useState<View | null>(null); const [checked, setChecked] = useState(false);
 const [decision, setDecision] = useState<"approved" | "rejected">("rejected"); const [reason, setReason] = useState("");
 const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [revision, setRevision] = useState(0);
 const operation = useRef<AbortController | null>(null); const objectUrl = useRef<string | null>(null);
 const clear = useCallback(() => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; setView(null); setChecked(false); }, []);
 const rendered = useCallback(() => setView(old => old ? { ...old, rendered: true } : null), []);
 const pending = useCallback(() => { setChecked(false); setView(old => old ? { ...old, rendered: false } : null); }, []);
 const failed = useCallback(() => { clear(); setMessage("The file could not be shown. Reload this page before trying again."); }, [clear]);
 useEffect(() => {
  const abort = new AbortController(); operation.current = abort;
  (async () => { try {
   const response = await fetch(`/api/reviews/appeals/${caseId}`, { credentials: "same-origin", cache: "no-store", signal: abort.signal });
   const value = row.safeParse(await response.json()); const csrf = response.headers.get("x-inherit-csrf");
   const tokens = controls.safeParse(JSON.parse(response.headers.get("x-inherit-document-nonces") ?? "null"));
   if (response.status !== 200 || !value.success || value.data.caseId !== caseId || !csrf || !/^[0-9a-f]{64}$/u.test(csrf) || !tokens.success) throw new Error("unavailable");
   if (!abort.signal.aborted) { setLoaded({ value: value.data, csrf, controls: tokens.data }); setMessage(""); }
  } catch { if (!abort.signal.aborted) { setLoaded(null); setMessage("This request is not available. Sign in again and open the case assigned to you."); } } })();
  return () => { abort.abort(); operation.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
 }, [caseId, revision]);
 async function open(doc: z.infer<typeof document>) {
  if (!loaded || busy || doc.reviewState !== "pending" || !loaded.controls[doc.documentId]) return;
  clear(); const abort = new AbortController(); operation.current = abort; setBusy(true); let bytes: Uint8Array | undefined;
  try {
   const result = await readReviewDocument(doc.documentId, loaded.controls[doc.documentId]!.receipt, loaded.csrf, abort.signal); bytes = result.bytes;
   const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
   const media = ({ pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" } as Record<string, string>)[result.filename.split(".").at(-1) ?? ""];
   if (abort.signal.aborted || !media) throw new Error("unavailable");
   const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: media })); objectUrl.current = url;
   setView({ documentId: doc.documentId, url, media, sha256, rendered: false }); setMessage("");
  } catch { if (!abort.signal.aborted) setMessage("The full document could not be read. Reload this page before trying again."); }
  finally { bytes?.fill(0); if (!abort.signal.aborted) setBusy(false); }
 }
 async function save() {
  if (!loaded || !view?.rendered || !checked || busy || reason.trim().length < 20 || reason.length > 2000) return;
  const abort = new AbortController(); operation.current = abort; setBusy(true);
  try {
   const response = await fetch(`/api/legal-evidence/${view.documentId}/review`, { method: "POST", credentials: "same-origin", signal: abort.signal,
    headers: { "content-type": "application/json", "x-inherit-csrf": loaded.csrf }, body: JSON.stringify({ decision, documentSha256: view.sha256,
     reviewRevision: loaded.value.reviewRevision, nonce: loaded.controls[view.documentId]!.decision, reason }) });
   const value = z.object({ documentId: z.uuid(), status: z.literal("reviewed"), decision: z.enum(["approved", "rejected"]), reviewRevision: z.number().int().positive() }).strict().safeParse(await response.json());
   if (response.status !== 200 || !value.success || value.data.documentId !== view.documentId || value.data.decision !== decision || value.data.reviewRevision !== loaded.value.reviewRevision + 1) throw new Error("unavailable");
   clear(); setReason(""); setLoaded(null); setRevision(old => old + 1); setMessage("Decision saved.");
  } catch { if (!abort.signal.aborted) setMessage("The decision was not saved. Reload this page and check the current case before trying again."); }
  finally { if (!abort.signal.aborted) setBusy(false); }
 }
 return <section className="mt-6 space-y-6" aria-busy={busy}>
  {message && <p role="status">{message}</p>}
  {loaded && <><p>Claimant: {loaded.value.claimantName}.</p><p>{loaded.value.statement}</p>
   <p>Read each full document. A document decision does not grant access or decide the outcome of this request.</p>
   {loaded.value.evidence.map(doc => <section key={doc.documentId} className="space-y-3 rounded-xl border p-4"><h2>{names[doc.kind]}</h2>
    <p>Review: {doc.reviewState}.</p><button type="button" disabled={busy || doc.reviewState !== "pending"} onClick={() => void open(doc)}>Open file</button></section>)}
   {view && <section className="space-y-4">
    {view.media === "application/pdf" ? <ReviewPdfDocument url={view.url} title="Review document" onRendered={rendered} onPending={pending} onFailure={failed} />
     : <Image src={view.url} alt="Review document" width={500} height={600} unoptimized referrerPolicy="no-referrer" className="max-h-96 w-full object-contain"
      onLoad={event => { if (event.currentTarget.complete && event.currentTarget.naturalWidth > 0) setView(old => old ? { ...old, rendered: true } : null); }} onError={() => clear()} />}
    <label className="block"><input type="checkbox" checked={checked} disabled={!view.rendered || busy} onChange={event => setChecked(event.target.checked)} /> I read this file.</label>
    <label className="block">Document decision<select value={decision} disabled={busy} onChange={event => setDecision(event.target.value as "approved" | "rejected")}>
     <option value="approved">Approve document</option><option value="rejected">Refuse document</option></select></label>
    <label className="block">Reason<textarea value={reason} maxLength={2000} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
    <p>Record what you checked. Do not copy document content into the reason.</p>
    <button type="button" onClick={() => void save()} disabled={busy || !view.rendered || !checked || reason.trim().length < 20}>Save decision</button>
   </section>}
  </>}
 </section>;
}
