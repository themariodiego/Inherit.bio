import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InputProvenance } from "@/components/reports/input-provenance";
import { ScorePanelResult } from "@/components/results/polygenic/score-panel-result";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { Button } from "@/components/ui/button";
import {
  BROWSE_VARIANTS,
  DATA_CRUMB,
  DATA_H1,
  DATA_LEDE,
  MANAGE_FILES,
  SCORE_COVERAGE_HEADING,
  SCORE_COVERAGE_NO_FILE,
  SCORE_COVERAGE_NONE,
  scoreInputLabel,
} from "@/copy/genome/data";
import { NAV_LABELS } from "@/copy/navigation";
import { getSubjectFileCount } from "@/lib/genome/load";
import { getPreparedSourceFiles } from "@/lib/genome/prepared-sources";
import { scorePanel } from "@/lib/genome/prs-panel";
import { loadInputSources } from "@/lib/genome/input-sources";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: DATA_H1 };

export default async function GenomeDataPage(
  props: PageProps<"/genome/[subject]/data">,
) {
  const { subject: segment } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const subject = await resolveSubjectForAccount(user.id, segment);
  if (!subject) notFound();
  const subjectParams = { subject: subject.routeSegment };
  const base = route("genome.subject", subjectParams);

  const admin = createAdminClient();
  // The coverage facts read the processed files; the subject bar counts
  // every file in the record, whatever its status.
  const [files, fileCount] = await Promise.all([
    getPreparedSourceFiles(admin, subject.id),
    getSubjectFileCount(admin, subject.id),
  ]);

  // Per-score panel coverage facts (name, id, matched of n, ancestry note).
  // The coverage share is not read: the `coverage` figure ("read X of the Y
  // positions this needs") is the one statement of panel coverage (§7.6).
  // No percentile renders anywhere: every shipped score can only be scored
  // against a global fallback panel, so nothing numeric about risk is shown
  // (§4 §2.5, X4.2).
  // No version column is selected because `prs_scores` has none; the panel
  // facts are built by `scorePanel` and the surface states the absence of a
  // version in words rather than implying one (G4.4, src/lib/genome/prs-panel.ts).
  const { data: prsRows } = files.length > 0
    ? await supabase
        .from("user_prs")
        .select("pgs_id, matched, file_id")
        .eq("subject_id", subject.id)
        .in("file_id", files.map((file) => file.id))
    : { data: [] };
  const pgsIds = (prsRows ?? []).map((row) => row.pgs_id);
  const { data: prsMeta } = pgsIds.length
    ? await admin
        .from("prs_scores")
        .select("pgs_id, name, trait, n_variants, ancestry_note")
        .in("pgs_id", pgsIds)
    : { data: [] };
  const metaById = new Map((prsMeta ?? []).map((meta) => [meta.pgs_id, meta]));
  const scores = (prsRows ?? [])
    .flatMap((row) => {
      const meta = metaById.get(row.pgs_id);
      return meta ? [{ row, meta }] : [];
    })
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  const inputSources = await loadInputSources(admin, subject.id, scores.map(({ row }) => row.file_id),
    { kind: "report", purpose: "reports.polygenic" });

  return (
    <div data-surface="standard" className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS["my-genome"], href: base },
          { label: subject.displayLabel },
          { label: DATA_CRUMB },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />
      <header className="space-y-3">
        <h1 className="display text-3xl">{DATA_H1}</h1>
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">{DATA_LEDE}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href={route("genome.browser", subjectParams)}>{BROWSE_VARIANTS}</Link>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href={route("files.index")}>{MANAGE_FILES}</Link>
        </Button>
      </div>

      <section aria-labelledby="score-panel-coverage" className="space-y-3">
        <h2 id="score-panel-coverage" className="text-lg font-semibold text-ink">
          {SCORE_COVERAGE_HEADING}
        </h2>
        {files.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{SCORE_COVERAGE_NO_FILE}</p>
        ) : scores.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{SCORE_COVERAGE_NONE}</p>
        ) : (
          <ul className="space-y-3">
            {scores.map(({ row, meta }) => (
              <li key={`${row.file_id}:${row.pgs_id}`} data-slot="score-panel-result">
                <ScorePanelResult
                  subjectId={subject.id}
                  panel={scorePanel(meta)}
                  trait={meta.trait}
                  ancestryNote={meta.ancestry_note}
                  read={row.matched}
                  needed={meta.n_variants}
                />
                {/* inherit-figure-exempt: a source-record label, not a genetic quantity */}
                <p data-slot="score-input-label" className="mt-2 text-sm text-ink-muted">
                  {scoreInputLabel(inputSources.findIndex((source) => source.fileId === row.file_id) + 1)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {scores.length ? <div data-slot="score-input-provenance">
        <InputProvenance sources={inputSources} subject={{ subjectId: subject.id }} />
      </div> : null}
    </div>
  );
}
