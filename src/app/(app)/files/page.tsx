import type { Metadata } from "next";
import Link from "next/link";
import { Uploader } from "@/components/uploads/uploader";
import { AutoRefresh } from "@/components/uploads/auto-refresh";
import { FileRowActions } from "@/components/uploads/file-row-actions";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: stats } = await createAdminClient().rpc("processing_time_stats");
  const tier1 = stats?.find((s: { file_tier: number }) => s.file_tier === 1);

  const inFlight = (files ?? []).some(
    (f) => f.status === "parsing" || f.status === "uploading",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <AutoRefresh active={inFlight} />
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

      <div className="space-y-1 text-xs text-ink-muted">
        <p>
          Your own DNA only — files from children or relatives aren&rsquo;t
          allowed (
          <Link
            href="/terms#eligibility"
            className="underline underline-offset-2"
          >
            Terms
          </Link>
          ).
        </p>
        {/* <wbr /> after each slash lets the provider token wrap on narrow
            screens instead of forcing a horizontal body overflow. */}
        <p className="break-words">
          Not sure which file you have? 23andMe/<wbr />
          Ancestry/<wbr />
          MyHeritage exports are .txt or .csv; clinical/lab files are usually
          .vcf or .vcf.gz.
        </p>
      </div>

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
                {f.status === "annotated" ? (
                  <Link
                    href="/genome/me/reports"
                    className="whitespace-nowrap text-xs text-forest underline underline-offset-2"
                  >
                    See your reports →
                  </Link>
                ) : null}
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
