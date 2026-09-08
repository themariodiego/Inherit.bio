"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fileDeletionError } from "@/copy/upload/file-deletion";
import { BrowserPreparationError, prepareSubjectFile } from "@/lib/uploads/subject-upload-browser";

export function FileRowActions({
  fileId,
  status,
  tier,
  preparationOnly = false,
}: {
  fileId: string;
  status: string;
  tier: number;
  preparationOnly?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-1.5">
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
            if (preparationOnly) {
              try { await prepareSubjectFile(fileId); }
              catch (error) {
                setError(error instanceof BrowserPreparationError && error.code === "build_unknown"
                  ? "Ask your file provider for raw DNA data that states GRCh37 or GRCh38."
                  : "Preparation did not finish. Please retry; you do not need to upload the file again.");
              } finally { setBusy(false); router.refresh(); }
              return;
            }
            // The route flips status to "parsing" as it starts; refresh
            // early so the badge reflects that while the run continues.
            const earlyRefresh = setTimeout(() => router.refresh(), 1500);
            const res = await fetch(`/api/files/${fileId}/process`, {
              method: "POST",
            }).catch(() => null);
            clearTimeout(earlyRefresh);
            if (!res?.ok) {
              const detail = res ? await res.text().catch(() => "") : "";
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
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              "Delete this file, its variants, and file-based results? This cannot be undone.",
            )
          )
            return;
          setBusy(true);
          setError(null);
          try {
            const response = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
            if (!response.ok) {
              const result = await response.json().catch(() => null);
              setError(fileDeletionError(result?.error));
              return;
            }
            router.refresh();
          } catch {
            setError(fileDeletionError(null));
          } finally {
            setBusy(false);
          }
        }}
      >
        Delete
      </Button>
    </div>
    {error ? (
      <p role="alert" className="max-w-xs text-right text-xs text-danger">
        {error}
      </p>
    ) : null}
    </div>
  );
}
