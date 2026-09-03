import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimBlock } from "@/components/figures/claim-block";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { Button } from "@/components/ui/button";
import type { CoverageSpec } from "@/lib/figures/spec";
import { getSubjectFileCount, getSubjectProcessedFiles } from "@/lib/genome/load";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Genome data" };

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
    getSubjectProcessedFiles(admin, subject.id),
    getSubjectFileCount(admin, subject.id),
  ]);

  // Per-score panel coverage facts (name, id, matched of n, coverage share,
  // ancestry note). No percentile renders anywhere: every shipped score can
  // only be scored against a global fallback panel, so nothing numeric about
  // risk is shown (§4 §2.5, X4.2).
  const { data: prsRows } = files.length > 0
    ? await admin
        .from("user_prs")
        .select("pgs_id, coverage, matched")
        .eq("subject_id", subject.id)
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Breadcrumbs
        items={[
          { label: "My Genome", href: base },
          { label: subject.displayLabel },
          { label: "Data" },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />
      <header className="space-y-3">
        <p className="eyebrow">Data</p>
        <h1 className="display text-3xl">{subject.displayLabel}&apos;s genome data</h1>
        <p className="text-base leading-relaxed text-ink-muted">
          Browse observed variants or manage the source files and their processing state.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href={route("genome.browser", subjectParams)}>Browse observed variants</Link>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href={route("files.index")}>Manage source files</Link>
        </Button>
      </div>

      <section aria-labelledby="score-panel-coverage" className="space-y-3">
        <h2 id="score-panel-coverage" className="text-lg font-semibold text-ink">
          Score panel coverage
        </h2>
        {files.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Add a file to see how much of each score panel it covers.
          </p>
        ) : scores.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No score panels have been checked against this file yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {scores.map(({ row, meta }) => {
              const coverage: CoverageSpec = {
                kind: "coverage",
                class: "estimate",
                basis: "observed",
                provenance: { kind: "computed", module: "genome/prs" },
                read: row.matched,
                needed: meta.n_variants,
              };
              return (
                <li key={row.pgs_id}>
                  <ClaimBlock subject={{ subjectId: subject.id }} figures={[coverage]}>
                    <p className="mt-2 text-sm text-ink">
                      <span className="font-medium">{meta.name}</span>{" "}
                      <span className="font-mono text-sm text-ink-muted">{row.pgs_id}</span>
                      {" · "}
                      <span className="text-ink-muted">{meta.trait}</span>
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {`${(row.coverage * 100).toFixed(1)}% of this score’s positions are in your file.`}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{meta.ancestry_note}</p>
                  </ClaimBlock>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
