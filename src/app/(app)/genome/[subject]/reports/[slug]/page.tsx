import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SensitiveGate } from "@/components/reports/sensitive-gate";
import { SupportPanel } from "@/components/reports/support-panel";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, EVIDENCE_LABELS } from "@/lib/genome/categories";
import {
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
} from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report" };

const SENSITIVE_CATEGORIES = new Set([
  "cancer-risk",
  "neurodegenerative",
  "mental-health",
]);

const CLINICAL_CONFIRMATION_RE =
  /confirm\w*\s+(?:by|with)\s+(?:a\s+)?clinical|clinical(?:[-\s](?:laboratory|quality))?\s+confirmation|confirmation\s+is\s+sensible|deserves\s+confirmation/i;

export default async function ReportDetailPage(
  props: PageProps<"/genome/[subject]/reports/[slug]">,
) {
  const { slug, subject: subjectSegment } = await props.params;
  const searchParams = await props.searchParams;
  const revealParam =
    typeof searchParams.reveal === "string" ? searchParams.reveal : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const subject = await resolveSubjectForAccount(user.id, subjectSegment);
  if (!subject) notFound();

  const admin = createAdminClient();
  const [{ data: raw }, files] = await Promise.all([
    admin
      .from("report_templates")
      .select("slug, category, title, summary, evidence, variants, pgs_id, citations")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle(),
    getSubjectProcessedFiles(admin, subject.id),
  ]);
  if (!raw) notFound();
  const template = raw as unknown as ReportTemplate;

  const recommendsClinicalConfirmation = template.variants.some((variant) =>
    Object.values(variant.interpretations).some((text) =>
      CLINICAL_CONFIRMATION_RE.test(text),
    ),
  );
  const sensitive =
    SENSITIVE_CATEGORIES.has(template.category) ||
    recommendsClinicalConfirmation;
  const carrierStyle = template.category === "reproductive-family";
  const carrier = /\bcarrier\b/i.test(template.title);
  const hasData = files.length > 0;
  const gated = sensitive && hasData;
  const showSupport = (sensitive || carrierStyle) && hasData;
  const showResults = !gated || revealParam === "1";
  const reportsHref = `/genome/${subject.routeSegment}/reports`;
  const revealHref = `/genome/${subject.routeSegment}/reports/${encodeURIComponent(template.slug)}?reveal=1`;

  let resultsSection: ReactNode = null;
  if (showResults) {
    const { genotypes, conflicts } = hasData
      ? await getSubjectGenotypesByRsid(
          admin,
          subject.id,
          template.variants.map((variant) => variant.rsid),
        )
      : { genotypes: new Map<number, string>(), conflicts: new Set<number>() };
    const resolved = resolveTemplate(template, (rsid) => genotypes.get(rsid));

    const [{ data: prsRows }, { data: prsMeta }] = await Promise.all([
      template.pgs_id && hasData
        ? admin
            .from("user_prs")
            .select("raw_score, zscore, percentile, coverage, matched, pgs_id, computed_at")
            .eq("subject_id", subject.id)
            .eq("pgs_id", template.pgs_id)
            .order("computed_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [] }),
      template.pgs_id
        ? admin
            .from("prs_scores")
            .select("pgs_id, name, trait, n_variants, ancestry_note, citation, source_url")
            .eq("pgs_id", template.pgs_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const prs = prsRows?.[0] ?? null;

    resultsSection = (
      <>
        {template.variants.map((variant) => {
          const outcome = resolved.variants.find(
            (item) => item.variant.rsid === variant.rsid,
          )!.outcome;
          const conflict = conflicts.has(variant.rsid);
          return (
            <section
              key={variant.rsid}
              className="rounded-2xl border border-line bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  {variant.gene} ·{" "}
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/snp/rs${variant.rsid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm underline underline-offset-2"
                  >
                    rs{variant.rsid}
                  </a>
                </h2>
                <p className="font-mono text-xs text-ink-muted">
                  chr{variant.chrom === 23 ? "X" : variant.chrom === 24 ? "Y" : variant.chrom === 25 ? "MT" : variant.chrom}
                  :{variant.pos38.toLocaleString()} {variant.ref}→{variant.alt}
                </p>
              </div>
              <div className="mt-4">
                {!hasData ? (
                  <p className="text-sm text-ink-muted">
                    Upload and process a file to see a result here.
                  </p>
                ) : conflict ? (
                  <p className="text-sm text-ink-muted">
                    This subject&apos;s processed files disagree at this position,
                    so Inherit shows no interpretation.
                  </p>
                ) : outcome.status === "genotyped" ? (
                  <>
                    <p className="text-sm">
                      <span className="mr-2 rounded-full bg-tint px-3 py-1 font-mono">
                        {outcome.genotype.length === 2
                          ? `${outcome.genotype[0]}/${outcome.genotype[1]}`
                          : outcome.genotype}
                      </span>
                      Your genotype
                      {outcome.strandFlipped ? (
                        <span className="ml-2 text-xs text-ink-muted">
                          (opposite strand, resolved unambiguously)
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed">
                      {outcome.interpretation}
                    </p>
                  </>
                ) : outcome.status === "not-covered" ? (
                  <p className="text-sm text-ink-muted">
                    This subject&apos;s files do not cover this variant. Inherit
                    never guesses an unobserved genotype.
                  </p>
                ) : outcome.status === "no-call" ? (
                  <p className="text-sm text-ink-muted">
                    The source includes this position but did not make a
                    confident call, so no result is shown.
                  </p>
                ) : (
                  <p className="text-sm text-ink-muted">
                    The observed genotype ({outcome.genotype}) does not match
                    this report&apos;s expected alleles, so no interpretation is
                    shown.
                  </p>
                )}
              </div>
            </section>
          );
        })}

        {prsMeta ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-medium">Polygenic score · {prsMeta.pgs_id}</h2>
            <p className="mt-1 text-xs text-ink-muted">
              {prsMeta.name} ({prsMeta.n_variants.toLocaleString()} variants) ·{" "}
              <a
                href={prsMeta.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                PGS Catalog
              </a>
            </p>
            {prs ? (
              <div className="mt-4 space-y-3 text-sm">
                <p>
                  {prs.percentile == null ? (
                    "A percentile could not be computed from the available coverage."
                  ) : (
                    <>
                      Approximately the <strong>{Math.round(prs.percentile)}th percentile</strong>{" "}
                      of a population-reference distribution.
                    </>
                  )}
                </p>
                <p>
                  <strong>Coverage:</strong> {(prs.coverage * 100).toFixed(1)}%
                  ({" "}{prs.matched.toLocaleString()} of {prsMeta.n_variants.toLocaleString()} variants).
                  Treat this as an approximation.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                No score has been computed for this subject.
              </p>
            )}
            <p className="mt-4 rounded-lg bg-tint p-3 text-xs leading-relaxed">
              <strong>Ancestry portability:</strong> {prsMeta.ancestry_note}
            </p>
          </section>
        ) : null}

        {showSupport ? <SupportPanel carrier={carrier} /> : null}
      </>
    );
  }

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="eyebrow mb-2">
          {CATEGORY_LABELS[template.category] ?? template.category}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-3xl">{template.title}</h1>
          <Badge variant="secondary">
            {EVIDENCE_LABELS[template.evidence]}
          </Badge>
        </div>
        <p className="mt-3 text-ink-muted">{template.summary}</p>
        {hasData ? (
          <p className="mt-2 text-xs text-ink-muted">
            Results combine {files.length} processed {files.length === 1 ? "file" : "files"} for {subject.displayLabel}.
          </p>
        ) : null}
      </div>

      {showResults ? (
        resultsSection
      ) : (
        <SensitiveGate
          userId={user.id}
          category={template.category}
          categoryLabel={CATEGORY_LABELS[template.category] ?? template.category}
          revealHref={revealHref}
          returnHref={reportsHref}
        />
      )}

      <section>
        <h2 className="eyebrow mb-2">Sources</h2>
        <ul className="space-y-1 text-sm">
          {template.citations.map((citation, index) => (
            <li key={`${citation.label}-${index}`}>
              {citation.pmid ? (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${citation.pmid}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {citation.label} (PMID {citation.pmid})
                </a>
              ) : citation.doi ? (
                <a
                  href={`https://doi.org/${citation.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {citation.label} (doi:{citation.doi})
                </a>
              ) : (
                citation.label
              )}
            </li>
          ))}
        </ul>
      </section>

      <p
        data-testid="report-disclaimer"
        className="rounded-xl border border-line p-4 text-xs leading-relaxed text-ink-muted"
      >
        This report is informational, not medical advice, and Inherit is not a
        diagnostic service. Talk to a clinician or genetic counselor before
        acting on anything here.
      </p>

      <p className="text-sm">
        <Link href={reportsHref} className="underline underline-offset-2">
          ← All reports
        </Link>
      </p>
    </article>
  );
}
