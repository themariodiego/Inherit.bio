import type { Metadata } from "next";
import { Uploader } from "@/components/uploads/uploader";
import { FileRowActions } from "@/components/uploads/file-row-actions";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/limits";

export const metadata: Metadata = { title: "My files" };

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading",
  uploaded: "Awaiting processing",
  parsing: "Processing…",
  parsed: "Parsed",
  annotated: "Processed",
  failed: "Failed",
  stored: "Stored (Tier 2)",
};

export default async function UploadsPage() {
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("genome_files")
    .select(
      "id, original_name, file_type, tier, size_bytes, sha256, status, build, variant_count, error, created_at, processing_started_at, processing_finished_at",
    )
    .order("created_at", { ascending: false });

  const { data: stats } = await supabase.rpc("processing_time_stats");
  const tier1 = stats?.find((s: { file_tier: number }) => s.file_tier === 1);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="eyebrow mb-2">Ingestion</p>
        <h1 className="display text-3xl">My files</h1>
        {tier1 && tier1.p50_seconds != null ? (
          <p className="mt-2 text-sm text-ink-muted">
            Measured processing time on this deployment (last 90 days,{" "}
            {tier1.n} file{tier1.n === 1 ? "" : "s"}): median{" "}
            {tier1.p50_seconds}s, 95th percentile {tier1.p95_seconds}s.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Processing times are measured and shown here once this deployment
            has processed files — no marketing estimates.
          </p>
        )}
      </div>

      <Uploader />

      <ul className="space-y-3">
        {(files ?? []).map((f) => (
          <li
            key={f.id}
            className="rounded-xl border border-line bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{f.original_name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {f.file_type.replace("array_", "array · ")} ·{" "}
                  {formatBytes(f.size_bytes)}
                  {f.build ? ` · ${f.build}` : ""}
                  {f.variant_count
                    ? ` · ${f.variant_count.toLocaleString()} variants`
                    : ""}
                </p>
                {f.sha256 ? (
                  <p className="mt-0.5 font-mono text-[10px] text-ink-muted">
                    sha256 {f.sha256.slice(0, 32)}…
                  </p>
                ) : null}
                {f.status === "failed" && f.error ? (
                  <p className="mt-1 text-xs text-danger">{f.error}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={f.status === "failed" ? "destructive" : "secondary"}
                >
                  {STATUS_LABEL[f.status] ?? f.status}
                </Badge>
                <FileRowActions
                  fileId={f.id}
                  status={f.status}
                  tier={f.tier}
                />
              </div>
            </div>
          </li>
        ))}
        {(files ?? []).length === 0 ? (
          <li className="rounded-xl border border-line p-6 text-sm text-ink-muted">
            No files yet. Upload a raw data export to get started — or grab a
            provider from the directory first.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
