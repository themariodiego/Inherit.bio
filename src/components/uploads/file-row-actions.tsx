"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fileDeletionError } from "@/copy/upload/file-deletion";

export function FileRowActions({
  fileId,
  status,
  tier,
}: {
  fileId: string;
  status: string;
  tier: number;
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
          {busy ? "Processing…" : status === "failed" ? "Retry" : "Process"}
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
