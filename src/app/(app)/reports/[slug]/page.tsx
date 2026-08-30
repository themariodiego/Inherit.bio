import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SensitiveGate } from "@/components/reports/sensitive-gate";
import { SupportPanel } from "@/components/reports/support-panel";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, EVIDENCE_LABELS } from "@/lib/genome/categories";
import { getActiveFile, getGenotypesByRsid } from "@/lib/genome/load";
import {
  resolveTemplate,
  type ReportTemplate,
} from "@/lib/genome/reports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report" };

// Categories whose results can be life-altering enough to warrant an
// explicit opt-in before the genotype section renders.
const SENSITIVE_CATEGORIES = new Set([
  "cancer-risk",
  "neurodegenerative",
  "mental-health",
]);

// Templates whose interpretations recommend clinical confirmation (rare,
// high-impact variants like LRRK2 G2019S, GBA1 N370S, CFTR F508del, Factor V
// Leiden) are treated as sensitive regardless of category. Matches the
// phrasings used across the seed templates ("confirmed with clinical-quality
// sequencing", "clinical-laboratory confirmation", "confirmation is
// sensible", "deserves confirmation") without tripping on "unconfirmed" or
// "needs confirmation in other populations".
const CLINICAL_CONFIRMATION_RE =
  /confirm\w*\s+(?:by|with)\s+(?:a\s+)?clinical|clinical(?:[-\s](?:laboratory|quality))?\s+confirmation|confirmation\s+is\s+sensible|deserves\s+confirmation/i;

export default async function ReportDetailPage(
  props: PageProps<"/reports/[slug]">,
) {
  const { slug } = await props.params;
  const searchParams = await props.searchParams;
  const fileParam =
    typeof searchParams.file === "string" ? searchParams.file : undefined;
  const revealParam =
    typeof searchParams.reveal === "string" ? searchParams.reveal : undefined;

  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("report_templates")
    .select("slug, category, title, summary, evidence, variants, pgs_id, citations")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!raw) notFound();
  const template = raw as unknown as ReportTemplate;

  // The signed-in user scopes the gate's device-local memory (the (app)
  // layout already redirects signed-out visitors before this page renders).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const active = await getActiveFile(supabase, fileParam);

  const recommendsClinicalConfirmation = template.variants.some((v) =>
    Object.values(v.interpretations).some((text) =>
      CLINICAL_CONFIRMATION_RE.test(text),
    ),
  );
  const sensitive =
    SENSITIVE_CATEGORIES.has(template.category) ||
    recommendsClinicalConfirmation;
  // Carrier-style reports get the support pathway too, and carrier-status
  // reports specifically get the partner-testing note.
  const carrierStyle = template.category === "reproductive-family";
  const carrier = /\bcarrier\b/i.test(template.title);
  // With no processed file there is no result to protect or be concerned by —
  // the sections just say "upload a file" — so neither the gate nor the
  // support panel applies.
  const gated = sensitive && active != null;
  const showSupport = (sensitive || carrierStyle) && active != null;

  // Revealing a gated result is a SERVER-side decision carried by the URL
  // (?reveal=1). Everything the tree renders — client-component children
  // included — is serialized into the page's RSC flight payload, so a gated
  // response must never *contain* the result and merely hide it client-side.
  // Unless the reveal param is present, the result section below is neither
  // fetched nor built, so no genotype reaches the wire.
  const showResults = !gated || revealParam === "1";

  let resultsSection: ReactNode = null;
  if (showResults) {
    const genotypes = active
      ? await getGenotypesByRsid(
          supabase,
          active.id,
          template.variants.map((v) => v.rsid),
        )
      : new Map<number, string>();
    const resolved = resolveTemplate(template, (rsid) => genotypes.get(rsid));

    const prs =
      template.pgs_id && active
        ? (
            await supabase
              .from("user_prs")
              .select("raw_score, zscore, percentile, coverage, matched, pgs_id")
              .eq("file_id", active.id)
              .eq("pgs_id", template.pgs_id)
              .maybeSingle()
          ).data
        : null;
    const prsMeta = template.pgs_id
      ? (
          await supabase
            .from("prs_scores")
            .select("pgs_id, name, trait, n_variants, ancestry_note, citation, source_url")
            .eq("pgs_id", template.pgs_id)
            .maybeSingle()
        ).data
      : null;

    resultsSection = (
      <>
        {template.variants.map((v) => {
          const r = resolved.variants.find(
            (x) => x.variant.rsid === v.rsid,
          )!.outcome;
          return (
            <section
              key={v.rsid}
              className="rounded-2xl border border-line bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  {v.gene} ·{" "}
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/snp/rs${v.rsid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm underline underline-offset-2"
                  >
                    rs{v.rsid}
                  </a>
                </h2>
                <p className="font-mono text-xs text-ink-muted">
                  chr{v.chrom === 23 ? "X" : v.chrom === 24 ? "Y" : v.chrom === 25 ? "MT" : v.chrom}
                  :{v.pos38.toLocaleString()} {v.ref}→{v.alt}
                </p>
              </div>
              <div className="mt-4">
                {!active ? (
                  <p className="text-sm text-ink-muted">
                    Upload and process a file to see your genotype here.
                  </p>
                ) : r.status === "genotyped" ? (
                  <>
                    <p className="text-sm">
                      {/* The explicit space keeps screen readers from running
                          the genotype and its label together ("C/TYour
                          genotype"). */}
                      <span className="mr-2 rounded-full bg-tint px-3 py-1 font-mono">
                        {r.genotype.length === 2
                          ? `${r.genotype[0]}/${r.genotype[1]}`
                          : r.genotype}
                      </span>{" "}
                      Your genotype
                      {r.strandFlipped ? (
                        <span className="ml-2 text-xs text-ink-muted">
                          (probe reported on the opposite strand; resolved
                          unambiguously)
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed">
                      {r.interpretation}
                    </p>
                  </>
                ) : r.status === "not-covered" ? (
                  active.file_type === "vcf" || active.file_type === "gvcf" ? (
                    <p className="text-sm text-ink-muted">
                      Your file does not cover this variant. VCF files from
                      clinical or targeted tests usually list only the positions
                      where you differ from the reference (or only one region),
                      so Inherit cannot tell &ldquo;tested and normal&rdquo;
                      apart from &ldquo;not tested&rdquo; here — and it never
                      guesses genotypes it hasn&apos;t observed. If your lab can
                      provide a gVCF or whole-genome file, more reports will
                      resolve.
                    </p>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Your file does not cover this variant. Array files test a
                      fixed set of positions; whole-genome data covers more.
                      Inherit never imputes genotypes it hasn&apos;t observed.
                    </p>
                  )
                ) : r.status === "no-call" ? (
                  <p className="text-sm text-ink-muted">
                    Your file includes this position but the test could not make
                    a confident call there (a &ldquo;no-call&rdquo;), so no
                    result is shown.
                  </p>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Your file&apos;s genotype at this position (
                    <span className="font-mono">{r.genotype}</span>) does not
                    match this report&apos;s expected alleles, so no
                    interpretation is shown. This can happen with unusual probe
                    chemistry or rare alleles.
                  </p>
                )}
              </div>
            </section>
          );
        })}

        {prsMeta ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-medium">
              Polygenic score · {prsMeta.pgs_id}
            </h2>
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
                {prs.percentile != null ? (
                  <>
                    <p>
                      Your score is at approximately the{" "}
                      <strong>{Math.round(prs.percentile)}th percentile</strong>{" "}
                      of a population-reference distribution (z ={" "}
                      {prs.zscore?.toFixed(2)}).
                    </p>
                    <div
                      role="img"
                      aria-label={`Score percentile ${Math.round(prs.percentile)}`}
                      className="relative h-2 overflow-hidden rounded-full bg-tint"
                    >
                      <span
                        className="absolute top-0 h-full w-1.5 rounded-full bg-forest"
                        style={{ left: `${Math.min(99, Math.max(1, prs.percentile))}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p>
                    A percentile could not be computed for your file (too little
                    of the score&apos;s weight has reference allele
                    frequencies).
                  </p>
                )}
                <p>
                  <strong>Coverage:</strong> your file covered{" "}
                  {(prs.coverage * 100).toFixed(1)}% of this score&apos;s
                  variants ({prs.matched.toLocaleString()} of{" "}
                  {prsMeta.n_variants.toLocaleString()}). Uncovered variants are
                  excluded, which shifts the score — treat it as an
                  approximation.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                No score computed for your current file
                {active ? "" : " — upload and process a file first"}.
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

  // The gate's "Show my result" is a plain link back to this same URL with
  // ?reveal=1 (preserving any explicit file selection), so opting in stays a
  // server-side decision rather than a client-side unhide.
  const revealQuery = new URLSearchParams();
  if (fileParam) revealQuery.set("file", fileParam);
  revealQuery.set("reveal", "1");
  const revealHref = `/reports/${template.slug}?${revealQuery.toString()}`;

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
        {active ? (
          <p className="mt-2 text-xs text-ink-muted">
            Results computed from <strong>{active.original_name}</strong>,
            entirely on this deployment&apos;s own infrastructure.
          </p>
        ) : null}
      </div>

      {showResults ? (
        resultsSection
      ) : (
        <SensitiveGate
          userId={user?.id ?? ""}
          category={template.category}
          categoryLabel={CATEGORY_LABELS[template.category] ?? template.category}
          revealHref={revealHref}
        />
      )}

      <section>
        <h2 className="eyebrow mb-2">Sources</h2>
        <ul className="space-y-1 text-sm">
          {template.citations.map((c, i) => (
            <li key={i}>
              {c.pmid ? (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {c.label} (PMID {c.pmid})
                </a>
              ) : c.doi ? (
                <a
                  href={`https://doi.org/${c.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {c.label} (doi:{c.doi})
                </a>
              ) : (
                c.label
              )}
            </li>
          ))}
        </ul>
      </section>

      <p
        data-testid="report-disclaimer"
        className="rounded-xl border border-line p-4 text-xs leading-relaxed text-ink-muted"
      >
        This report is informational, not medical advice, and Inherit is not
        a diagnostic service. Genetic associations describe averages across
        studies, not certainties about you; environment, lifestyle and other
        genes matter too. Talk to a clinician or genetic counselor before
        acting on anything here.
      </p>

      <p className="text-sm">
        <Link href="/reports" className="underline underline-offset-2">
          ← All reports
        </Link>
      </p>
    </article>
  );
}
