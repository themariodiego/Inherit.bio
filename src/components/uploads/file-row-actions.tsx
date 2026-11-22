"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCsrf } from "@/components/security/csrf-provider";
import { Button } from "@/components/ui/button";
import { deleteFileUntilSettled } from "@/lib/uploads/file-delete-browser";
import { fileDeletionError } from "@/copy/upload/file-deletion";
import { BrowserPreparationError, prepareSubjectFile } from "@/lib/uploads/subject-upload-browser";
import { route } from "@/lib/primary-routes";
import { PreparationRecovery } from "./preparation-recovery";

/**
 * What the row shows of a failed Process answer: the body, as before. Since
 * 22 November 2026 api.file-process answers a signed-out request with
 * authenticated-api-v1's JSON 401 rather than a plain-text "Unauthorized"
 * (G8.5); the row shows the words it showed for that answer, so nothing a
 * person reads changes. A sentence of its own would be new wording.
 */
export function processDetail(status: number, body: string): string {
  if (status !== 401) return body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && (parsed as { error?: unknown }).error === "unauthenticated") return "Unauthorized";
  } catch { /* not JSON: shown as it is */ }
  return body;
}

export function FileRowActions({
  fileId,
  status,
  tier,
  preparationOnly = false,
  deleteNonce,
}: {
  fileId: string;
  status: string;
  tier: number;
  preparationOnly?: boolean;
  /**
   * The one-time value the Files page rendered for deleting this file
   * (api.file-delete, G8.5, 20 November 2026), bound to the account, its
   * session, the operation and this file, and stored nowhere; null when the
   * page has no session to bind one to, and then no Delete is offered.
   */
  deleteNonce: string | null;
}) {
  const router = useRouter();
  const processCsrf = useCsrf("api.file-process");
  const deleteCsrf = useCsrf("api.file-delete");
  const [busy, setBusy] = useState(false);
  const deletion = useRef<AbortController | null>(null);
  useEffect(() => () => deletion.current?.abort(), []);
  const [error, setError] = useState<string | null>(null);
  const [preparationError, setPreparationError] = useState<BrowserPreparationError["code"] | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
    <div className="rec-actions">
      <Button asChild variant="outline" size="xs">
        <a href={`/api/files/${fileId}/download`}>Download</a>
      </Button>
      {tier === 1 && (status === "uploaded" || status === "failed") ? (
        <Button
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setPreparationError(null);
            if (preparationOnly) {
              try { await prepareSubjectFile(fileId, { csrf: processCsrf }); }
              catch (error) {
                setPreparationError(error instanceof BrowserPreparationError ? error.code : "unavailable");
              } finally { setBusy(false); router.refresh(); }
              return;
            }
            // The route flips status to "parsing" as it starts; refresh
            // early so the status reflects that while the run continues.
            const earlyRefresh = setTimeout(() => router.refresh(), 1500);
            const res = await processCsrf.send((csrfToken) => fetch(`/api/files/${fileId}/process`, {
              method: "POST", headers: { "X-Inherit-CSRF": csrfToken },
            })).catch(() => null);
            clearTimeout(earlyRefresh);
            if (!res?.ok) {
              const detail = res ? processDetail(res.status, await res.text().catch(() => "")) : "";
              setError(
                detail.slice(0, 300) ||
                  `Processing failed${res ? ` (${res.status})` : ""}`,
              );
            }
            setBusy(false);
            router.refresh();
          }}
        >
          {preparationOnly ? (busy ? "Preparing…" : status === "failed" ? "Retry preparation" : "Prepare")
            : busy ? "Processing…" : status === "failed" ? "Retry" : "Process"}
        </Button>
      ) : null}
      {deleteNonce ? (
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={async () => {
          // The value this render of the row carries; a later render brings another.
          const nonce = deleteNonce;
          if (
            !nonce ||
            !window.confirm(
              "Delete this file, its variants, and file-based results? This cannot be undone.",
            )
          )
            return;
          setBusy(true);
          setError(null);
          setPreparationError(null);
          try {
            const controller = new AbortController();
            deletion.current = controller;
            const result = await deleteFileUntilSettled(fileId, controller.signal, deleteCsrf, nonce);
            if (controller.signal.aborted) return;
            if (result.status === "pending") {
              setError("Deletion is still pending. You can try Delete again to check progress. The file stays listed until deletion is complete.");
            } else if (result.status === "failed") {
              setError(fileDeletionError(result.code));
            }
            // After every answer the page renders again: without the row once
            // it is deleted, and otherwise with a fresh one-time value for it,
            // because the one this request carried may have been spent.
            router.refresh();
          } catch {
            setError(fileDeletionError(null));
            router.refresh();
          } finally {
            if (!deletion.current?.signal.aborted) setBusy(false);
            deletion.current = null;
          }
        }}
      >
        Delete
      </Button>
      ) : null}
    </div>
    {preparationError ? <div className="surface-inset surface-pad-sm max-w-measure text-sm">
      <PreparationRecovery code={preparationError} disabled={busy}
        reportsHref={route("genome.reports", { subject: "me" })} /></div> : null}
    {error ? (
      <p role="alert" className="max-w-xs text-right text-xs text-danger">
        {error}
      </p>
    ) : null}
    </div>
  );
}
