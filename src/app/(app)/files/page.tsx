import type { Metadata } from "next";
import Link from "next/link";
import { OwnUploadEntry } from "@/components/uploads/own-upload-entry";
import { HeldForYouRows, OtherAdultHeldRows, PathBChoicesSection } from "@/components/uploads/other-adult-upload-section";
import { AutoRefresh } from "@/components/uploads/auto-refresh";
import { FileRowActions } from "@/components/uploads/file-row-actions";
import { RecordHead } from "@/components/records/record-head";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { NAV_LABELS } from "@/copy/navigation";
import { ADD_A_FILE } from "@/copy/reports/strings";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileStatusLabel } from "@/lib/uploads/file-status";

const FILES_TITLE = "My files";

export const metadata: Metadata = { title: FILES_TITLE };

export default async function UploadsPage() {
  const supabase = await createClient();
  const [{ data: files }, { data: { user } }] = await Promise.all([
    supabase
      .from("genome_files")
      .select(
        "id, original_name, file_type, tier, size_bytes, sha256, status, build, variant_count, error, created_at, processing_started_at, processing_finished_at, single_logical_sample_verified_at, normalization_completed_at",
      )
      .order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);
  // The crumbs name the record these files belong to: the account's own
  // subject, read only for its label (round-2 M8).
  const self = user ? await resolveSubjectForAccount(user.id, "me") : null;

  const { data: stats } = await createAdminClient().rpc("processing_time_stats");
  const tier1 = stats?.find((s: { file_tier: number }) => s.file_tier === 1);

  const inFlight = (files ?? []).some(
    (f) => f.status === "parsing" || f.status === "uploading",
  );
  const rows = files ?? [];

  // The measured-or-withheld timing sentence is a caption beside the list,
  // not the lede under the h1 (round-1 m7).
  const timing = tier1 && tier1.p50_seconds != null ? (
    <p className="caption max-w-measure">
      Measured processing time on this deployment (last 90 days,{" "}
      {tier1.n} file{tier1.n === 1 ? "" : "s"}): median{" "}
      {tier1.p50_seconds}s, 95th percentile {tier1.p95_seconds}s.
    </p>
  ) : (
    <p className="caption max-w-measure">
      Processing times are measured and shown here once this deployment
      has processed files — no marketing estimates.
    </p>
  );

  return (
    <div className="page-stack rec-column-wide stack-sections">
      <AutoRefresh active={inFlight} />
      {/* The head (round-1 M7): with no file it carries the index's one
          sentence and the hills. The sentence is the file list's only item,
          so the index still states its absence in words inside the list, as
          it always has. No button here: the consent plate below is the
          action on this page, and its Continue turns forest once the
          disclosure is read (round-2 N1). A quiet link lands on that plate,
          so a phone's first viewport has something to act on (round-3 R1);
          the hills keep the height every record head has (round-4 S3). */}
      <RecordHead
        crumbs={self ? (
          <Breadcrumbs
            items={[
              { label: NAV_LABELS["my-genome"], href: route("genome.subject", { subject: self.routeSegment }) },
              { label: self.displayLabel },
              { label: FILES_TITLE },
            ]}
          />
        ) : undefined}
        title={FILES_TITLE}
        empty={rows.length === 0}
        seed={11}
      >
        {rows.length === 0 ? (
          <>
            <ul className="rec-record-list">
              <li className="body-lg max-w-measure text-ink">
                No files yet. Upload a raw data export to get started — or grab a
                provider from the directory first.
              </li>
            </ul>
            <p>
              <a href="#own-upload" className="link-target quiet-link">{ADD_A_FILE}</a>
            </p>
          </>
        ) : null}
      </RecordHead>

      <div className="rec-stack">
        {/* The anchor the head's quiet link lands on: focus moves here, and
            the next Tab is the plate's checkbox. */}
        <div id="own-upload" tabIndex={-1}>
          <OwnUploadEntry />
        </div>
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

      {rows.length ? (
        <div className="rec-stack">
          {timing}
          <ul className="rec-list">
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
          </ul>
        </div>
      ) : (
        timing
      )}
    </div>
  );
}
