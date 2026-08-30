import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABELS, EVIDENCE_LABELS } from "@/lib/genome/categories";
import {
  getActiveFile,
  getGenotypesByRsid,
  getProcessedFiles,
  getPublishedTemplates,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import { createClient } from "@/lib/supabase/server";
import { categoryRank, isFixtureSlug } from "@/components/reports/library";
import {
  ReportLibrary,
  type LibraryCard,
  type LibraryGroup,
} from "@/components/reports/report-library";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage(props: PageProps<"/reports">) {
  const searchParams = await props.searchParams;
  const fileParam =
    typeof searchParams.file === "string" ? searchParams.file : undefined;

  const supabase = await createClient();
  const [files, allTemplates] = await Promise.all([
    getProcessedFiles(supabase),
    getPublishedTemplates(supabase),
  ]);
  // Test fixtures never reach the user-facing library.
  const templates = allTemplates.filter((t) => !isFixtureSlug(t.slug));
  const active = await getActiveFile(supabase, fileParam);

  const genotypes = active
    ? await getGenotypesByRsid(supabase, active.id, templateRsids(templates))
    : new Map<number, string>();

  const resolved = templates.map((t) =>
    resolveTemplate(t, (rsid) => genotypes.get(rsid)),
  );
  const coveredCount = resolved.filter((r) => r.covered).length;

  // The user's polygenic scores for the active file, joined with score
  // metadata (same tables the report detail page's PGS block reads).
  const { data: prsRows } = active
    ? await supabase
        .from("user_prs")
        .select("pgs_id, percentile, coverage, matched")
        .eq("file_id", active.id)
    : { data: [] };
  const pgsIds = (prsRows ?? []).map((r) => r.pgs_id);
  const { data: prsMeta } = pgsIds.length
    ? await supabase
        .from("prs_scores")
        .select("pgs_id, name, trait, n_variants, ancestry_note")
        .in("pgs_id", pgsIds)
    : { data: [] };
  const metaById = new Map((prsMeta ?? []).map((m) => [m.pgs_id, m]));
  const reportByPgs = new Map<string, string>();
  for (const t of templates) {
    if (t.pgs_id && !reportByPgs.has(t.pgs_id)) {
      reportByPgs.set(t.pgs_id, t.slug);
    }
  }
  const scores = (prsRows ?? [])
    .flatMap((row) => {
      const meta = metaById.get(row.pgs_id);
      return meta ? [{ row, meta }] : [];
    })
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));

  const byCategory = new Map<string, LibraryCard[]>();
  for (const { template, covered } of resolved) {
    const list = byCategory.get(template.category) ?? [];
    list.push({
      slug: template.slug,
      title: template.title,
      summary: template.summary,
      evidenceLabel: EVIDENCE_LABELS[template.evidence] ?? template.evidence,
      genes: [...new Set(template.variants.map((v) => v.gene))],
      status: active ? (covered ? "covered" : "not-covered") : "awaiting",
    });
    byCategory.set(template.category, list);
  }
  const groups: LibraryGroup[] = [...byCategory.entries()]
    .map(([category, cards]) => ({
      id: category,
      label: CATEGORY_LABELS[category] ?? category,
      cards,
    }))
    .sort(
      (a, b) =>
        categoryRank(a.id) - categoryRank(b.id) ||
        a.label.localeCompare(b.label),
    );

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="eyebrow mb-2">Report library</p>
        <h1 className="display text-3xl">Reports</h1>
        {active ? (
          <p className="mt-2 text-sm text-ink-muted">
            Your file covers {coveredCount} of {templates.length} reports — a
            result is computed only when you open a report. Coverage is read
            from <strong>{active.original_name}</strong>
            {files.length > 1 ? (
              <>
                {" · "}
                {files
                  .filter((f) => f.id !== active.id)
                  .map((f) => (
                    <Link
                      key={f.id}
                      href={`/reports?file=${f.id}`}
                      className="underline underline-offset-2"
                    >
                      switch to {f.original_name}
                    </Link>
                  ))}
              </>
            ) : null}
            . The rest state honestly that your file doesn&apos;t cover their
            variants.
            {coveredCount === 0 &&
            (active.file_type === "vcf" || active.file_type === "gvcf") ? (
              <>
                {" "}
                <strong>Why zero?</strong> VCF files from clinical or targeted
                tests usually list only positions where you differ from the
                reference, so Inherit cannot tell &ldquo;tested and
                normal&rdquo; apart from &ldquo;not tested&rdquo; — this is a
                limit of the file, not of your test. Ask your lab for a gVCF
                or whole-genome file to unlock these reports.
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Upload and process a raw data file to see which reports it covers
            — each result is computed only when you open a report. The full
            library is browsable meanwhile.
          </p>
        )}
      </div>

      <section
        id="polygenic-scores"
        aria-labelledby="polygenic-scores-heading"
        className="scroll-mt-24"
      >
        <h2 id="polygenic-scores-heading" className="eyebrow mb-1">
          Polygenic scores
        </h2>
        <p className="mb-3 text-sm text-ink-muted">
          A polygenic score combines many small genetic effects into one
          estimate.
        </p>
        {scores.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {scores.map(({ row, meta }) => {
              const reportSlug = reportByPgs.get(row.pgs_id);
              return (
                <li
                  key={row.pgs_id}
                  className="rounded-xl border border-line bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium">
                      {reportSlug ? (
                        <Link
                          href={`/reports/${reportSlug}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {meta.name}
                        </Link>
                      ) : (
                        meta.name
                      )}
                    </h3>
                    <span className="shrink-0 font-mono text-[10px] text-ink-muted">
                      {row.pgs_id}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{meta.trait}</p>
                  {row.percentile != null ? (
                    <>
                      <p className="mt-3 text-sm">
                        Approximately the{" "}
                        <strong>
                          {Math.round(row.percentile)}th percentile
                        </strong>{" "}
                        of a population-reference distribution.
                      </p>
                      <div
                        role="img"
                        aria-label={`Score percentile ${Math.round(row.percentile)}`}
                        className="relative mt-2 h-2 overflow-hidden rounded-full bg-tint"
                      >
                        <span
                          className="absolute top-0 h-full w-1.5 rounded-full bg-forest"
                          style={{
                            left: `${Math.min(99, Math.max(1, row.percentile))}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-ink-muted">
                      A percentile could not be computed for your file.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-ink-muted">
                    Coverage: your file covered{" "}
                    {(row.coverage * 100).toFixed(1)}% of this score&apos;s
                    variants ({row.matched.toLocaleString()} of{" "}
                    {meta.n_variants.toLocaleString()}) — treat it as an
                    approximation.
                  </p>
                  <p className="mt-3 rounded-lg bg-tint p-2.5 text-xs leading-relaxed">
                    <strong>Ancestry portability:</strong> {meta.ancestry_note}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">
            No polygenic scores yet — they are computed when your file is
            processed.{" "}
            {active
              ? `None are available for ${active.original_name}.`
              : "Upload and process a raw data file to see yours."}
          </p>
        )}
      </section>

      <ReportLibrary groups={groups} />

      {templates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          The report library has not been seeded on this deployment yet.
        </p>
      ) : null}
    </div>
  );
}
