"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

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

  return (
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
            await fetch(`/api/files/${fileId}/process`, { method: "POST" });
            setBusy(false);
            router.refresh();
          }}
        >
          {status === "failed" ? "Retry" : "Process"}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              "Delete this file, its variants, and derived results? This cannot be undone.",
            )
          )
            return;
          setBusy(true);
          const supabase = createClient();
          const { data: row } = await supabase
            .from("genome_files")
            .select("bucket_path")
            .eq("id", fileId)
            .maybeSingle();
          if (row) {
            await supabase.storage.from("genomes").remove([row.bucket_path]);
          }
          await supabase.from("genome_files").delete().eq("id", fileId);
          setBusy(false);
          router.refresh();
        }}
      >
        Delete
      </Button>
    </div>
  );
}
