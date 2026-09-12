import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { viewerMaySee } from "@/lib/family/access";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: DATA_H1 };

export default async function GenomeDataPage(
  props: PageProps<"/genome/[subject]/data">,
) {
  const { subject: segment } = await props.params;
  const supabase = await createClient();
  // A family segment resolves here since 2026-09-12, under `raw.browse` — the
  // permission the operator created for exactly this: reading someone's file
  // inside Inherit, granted separately from downloading it.
  const context = await resolveSubjectRoute(segment, { anyOf: ["raw.browse"] });
  if (context.kind === "not-found") notFound();
  if (context.kind === "gate") {
    redirect(route("family.person", { person: context.personSegment }));
  }
  if (context.kind === "jurisdiction") {
    return (
      <CapabilityUnavailable
        eyebrow={NAV_LABELS.family}
        title={DATA_H1}
        backHref={route("family.index")}
      />
    );
  }
  const { user, subject, dataSubjectId, person, domain, displayLabel } = context;
  const subjectParams = { subject: subject.routeSegment };

  const admin = createAdminClient();
  // Panel coverage is built from `user_prs`, which is a polygenic RESULT.
  // `raw.browse` opens the file, not the analysis, so a relative who granted
  // only browsing sees the source facts and no score panel.
  const mayReadScores = person === null || viewerMaySee(person, "reports.polygenic");
  // The coverage facts read the processed files; the subject bar counts
  // every file in the record, whatever its status.
  const [files, fileCount] = await Promise.all([
    getPreparedSourceFiles(admin, dataSubjectId),
    getSubjectFileCount(admin, dataSubjectId),
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
  // `supabase` is the RLS client and returns nothing for another account's
  // subject, so a relative's panel is read through the service client — but
  // only after `resolveSubjectRoute` authorised the record AND that person
  // granted the polygenic layer. Without both it is not read at all, rather
  // than read and then hidden.
  const scoreClient = person === null ? supabase : admin;
  const { data: prsRows } = files.length > 0 && mayReadScores
    ? await scoreClient
        .from("user_prs")
        .select("pgs_id, matched, file_id")
        .eq("subject_id", dataSubjectId)
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
  const inputSources = await loadInputSources(admin, dataSubjectId, scores.map(({ row }) => row.file_id),
    { kind: "report", purpose: "reports.polygenic" });

  return (
    <div data-surface="standard" className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: domain.label, href: domain.href },
          { label: displayLabel },
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
                  subjectId={dataSubjectId}
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
        <InputProvenance sources={inputSources} subject={{ subjectId: dataSubjectId }} />
      </div> : null}
    </div>
  );
}
