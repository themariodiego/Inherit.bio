import type { Metadata } from "next";
import Link from "next/link";
import { OwnUploadEntry } from "@/components/uploads/own-upload-entry";
import { HeldForYouRows, OtherAdultHeldRows, PathBChoicesSection } from "@/components/uploads/other-adult-upload-section";
import { AutoRefresh } from "@/components/uploads/auto-refresh";
import { FileRowActions } from "@/components/uploads/file-row-actions";
import { Terrain } from "@/components/site/terrain";
import { createClient } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileStatusLabel } from "@/lib/uploads/file-status";

export const metadata: Metadata = { title: "My files" };

export default async function UploadsPage() {
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("genome_files")
    .select(
      "id, original_name, file_type, tier, size_bytes, sha256, status, build, variant_count, error, created_at, processing_started_at, processing_finished_at, single_logical_sample_verified_at, normalization_completed_at",
    )
    .order("created_at", { ascending: false });

  const { data: stats } = await createAdminClient().rpc("processing_time_stats");
  const tier1 = stats?.find((s: { file_tier: number }) => s.file_tier === 1);

  const inFlight = (files ?? []).some(
    (f) => f.status === "parsing" || f.status === "uploading",
  );
  const rows = files ?? [];

  return (
    <div className="page-stack rec-column-wide stack-sections">
      <AutoRefresh active={inFlight} />
      <header className="rec-head">
        <p className="eyebrow">Ingestion</p>
        <h1 className="display">My files</h1>
        {tier1 && tier1.p50_seconds != null ? (
          <p className="lede">
            Measured processing time on this deployment (last 90 days,{" "}
            {tier1.n} file{tier1.n === 1 ? "" : "s"}): median{" "}
            {tier1.p50_seconds}s, 95th percentile {tier1.p95_seconds}s.
          </p>
        ) : (
          <p className="lede">
            Processing times are measured and shown here once this deployment
            has processed files — no marketing estimates.
          </p>
        )}
      </header>

      <div className="rec-stack">
        <OwnUploadEntry />
        <div className="caption rec-stack-sm max-w-measure">
          <p>
            Your own DNA only — files from children or relatives aren&rsquo;t
            allowed (
            <Link href="/terms#eligibility" className="prose-link">
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
      </div>

      <OtherAdultHeldRows />
      <HeldForYouRows />
      <PathBChoicesSection />

      <ul className={rows.length ? "rec-list" : undefined}>
        {rows.map((f) => (
          <li key={f.id} className="rec-row">
            <div className="rec-main">
              <p className="rec-name">{f.original_name}</p>
              <p className="caption">
                {f.file_type.replace("array_", "array · ")} ·{" "}
                {formatBytes(f.size_bytes)}
                {f.build ? ` · ${f.build}` : ""}
                {f.variant_count
                  ? ` · ${f.variant_count.toLocaleString()} variants`
                  : ""}
              </p>
              {f.sha256 ? (
                <p className="caption">
                  <span className="mono">sha256 {f.sha256.slice(0, 32)}…</span>
                </p>
              ) : null}
              {f.status === "failed" && f.error ? (
                <p className="max-w-measure text-xs text-danger">{f.error}</p>
              ) : null}
            </div>
            {/* Wraps at the 320px support floor: the status, the reports link
                and the row actions need 370px side by side, which scrolled
                the whole page sideways (WCAG 2.1 SC 1.4.10). */}
            <div className="rec-actions">
              <span
                data-slot="file-status"
                className={f.status === "failed" ? "text-sm text-danger" : "text-sm text-ink-muted"}
              >
                {fileStatusLabel(f)}
              </span>
              {f.status === "annotated" ? (
                <Link
                  href="/genome/me/reports"
                  className="link-target prose-link whitespace-nowrap text-sm"
                >
                  See your reports →
                </Link>
              ) : f.status === "stored" && f.tier === 1 && f.normalization_completed_at !== null ? (
                <Link
                  href="/genome/me/reports"
                  className="link-target prose-link whitespace-nowrap text-sm"
                >
                  Choose reports →
                </Link>
              ) : null}
              <FileRowActions
                fileId={f.id}
                status={f.status}
                tier={f.tier}
                preparationOnly={f.single_logical_sample_verified_at !== null}
              />
            </div>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="surface relative overflow-hidden">
            {/* The empty state's ground: the hills, decorative only. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <Terrain variant="band" seed={11} className="absolute inset-0" />
            </div>
            <p className="relative max-w-measure px-6 py-14 text-base text-ink md:px-8">
              No files yet. Upload a raw data export to get started — or grab a
              provider from the directory first.
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
