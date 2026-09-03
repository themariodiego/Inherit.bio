import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ResultGate } from "@/components/family/result-gate";
import { isFixtureSlug } from "@/components/reports/library";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { TermDefinition } from "@/components/figures/term-definition";
import { NAV_LABELS } from "@/copy/navigation";
import {
  ANCESTRY_HEADING,
  BASELINE_ABSENT,
  COPILOT_LOCAL_ONLY,
  PAUSED_BODY,
  PERMISSIONS_HEADING,
  PERSON_H1,
  REPORTS_HEADING,
  noFileYet,
  noneCovered,
  notShared,
  nothingSharedYet,
  reportsLede,
} from "@/copy/family/person";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { LAYER_LABELS } from "@/copy/reports/strings";
import { grantedLayers, permits, personCapability, viewerMaySee } from "@/lib/family/access";
import { resolveFamilyPerson } from "@/lib/family/graph";
import { acknowledged } from "@/lib/family/tier2";
import {
  getPublishedTemplates,
  getSubjectFileCount,
  getSubjectGenotypesByRsid,
  getSubjectProcessedFiles,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import type { FindingLayer } from "@/lib/genome/taxonomy";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `/family/[person]` — one adult's own results (design §2.2; register
 * family.person, `layer-resolved`).
 *
 * Fixed order: breadcrumbs, the subject bar, the h1, then either the one
 * Tier-2 gate of the domain or the layers that person has actually shared.
 * While the gate is unset the page fetches nothing derived: no template, no
 * genotype and no file count is read, so a gated response carries no result
 * in its markup or in the RSC payload.
 *
 * A layer without a live grant is absent and stated once; nothing on this
 * page compares this person with anyone.
 */

const loadPerson = cache(async (segment: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const person = await resolveFamilyPerson(user.id, segment);
  return person ? { user, person } : null;
});

export async function generateMetadata(
  props: PageProps<"/family/[person]">,
): Promise<Metadata> {
  const { person: segment } = await props.params;
  const context = await loadPerson(segment);
  return {
    title: context ? `${context.person.displayLabel} · ${PERSON_H1}` : PERSON_H1,
  };
}

interface CoveredReport {
  slug: string;
  title: string;
}

export default async function FamilyPersonPage(props: PageProps<"/family/[person]">) {
  const { person: segment } = await props.params;
  const context = await loadPerson(segment);
  // A minor, an unknown record and a record belonging to someone else give
  // the same answer, so nothing signals that a record exists.
  if (!context) notFound();
  const { user, person } = context;

  const decision = await personCapability(user.id, person, "third_party_adult_analysis");
  const allowed = permits(decision);
  const gated = !(await acknowledged(user));
  const layers = allowed ? grantedLayers(person) : [];

  // Every read below happens only after the gate and only for a granted
  // layer: no file count, template or genotype is fetched otherwise.
  let fileCount: number | null = null;
  let hasFile = false;
  const covered = new Map<FindingLayer, CoveredReport[]>();
  if (allowed && !gated && layers.length > 0) {
    const admin = createAdminClient();
    const [count, files, allTemplates] = await Promise.all([
      getSubjectFileCount(admin, person.dataSubjectId),
      getSubjectProcessedFiles(admin, person.dataSubjectId),
      getPublishedTemplates(admin),
    ]);
    fileCount = count;
    hasFile = files.length > 0;
    const templates = allTemplates.filter(
      (template) => !isFixtureSlug(template.slug) && layers.includes(template.layer ?? "estimate"),
    );
    if (hasFile && templates.length > 0) {
      const { genotypes } = await getSubjectGenotypesByRsid(
        admin,
        person.dataSubjectId,
        templateRsids(templates),
      );
      for (const template of templates) {
        const resolved = resolveTemplate(template, (rsid) => genotypes.get(rsid));
        if (!resolved.covered) continue;
        const layer: FindingLayer = template.layer ?? "estimate";
        covered.set(layer, [
          ...(covered.get(layer) ?? []),
          { slug: template.slug, title: template.title },
        ]);
      }
    }
  }

  const subject = { ...person.handle, displayLabel: person.displayLabel };

  return (
    <div data-surface="standard" className="mx-auto max-w-4xl space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS.family, href: route("family.index") },
          { label: person.displayLabel },
        ]}
      />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />

      <header className="space-y-3">
        <h1 className="display text-3xl">{PERSON_H1}</h1>
      </header>

      {/* The states of §1.4, in the order a reader meets them. The Tier-2
          gate guards results, so it renders only where a result would: with
          nothing shared, or with sharing paused, there is nothing to gate
          and a wall would say less than the sentence does. */}
      {!allowed ? (
        <section role="status" className="max-w-prose space-y-3 rounded-2xl border border-line bg-card p-6">
          <p className="text-base leading-relaxed text-ink">{decision.userFacingCopy}</p>
        </section>
      ) : person.sharing === "paused" ? (
        <p role="status" className="max-w-prose text-base leading-relaxed text-ink">
          {PAUSED_BODY}
        </p>
      ) : layers.length === 0 ? (
        <p role="status" className="max-w-prose text-base leading-relaxed text-ink">
          {nothingSharedYet(person.displayLabel)}
        </p>
      ) : gated ? (
        <ResultGate />
      ) : (
        <>
          <section aria-labelledby="family-reports-heading" className="space-y-4">
            <h2 id="family-reports-heading" className="text-lg font-semibold">
              {REPORTS_HEADING}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
              {reportsLede(person.displayLabel)}
            </p>
            {!hasFile ? (
              <p className="text-base leading-relaxed text-ink">
                {noFileYet(person.displayLabel)}
              </p>
            ) : (
              (["variant_call", "estimate"] as const).map((layer) =>
                layers.includes(layer) ? (
                  <div key={layer} data-layer={layer} className="space-y-2">
                    <p className="text-base font-medium text-ink">{LAYER_LABELS[layer]}</p>
                    {(covered.get(layer) ?? []).length === 0 ? (
                      <p className="text-sm leading-relaxed text-ink">
                        {noneCovered(person.displayLabel, layer)}
                      </p>
                    ) : null}
                    <ul className="space-y-1">
                      {(covered.get(layer) ?? []).map((report) => (
                        <li key={report.slug}>
                          <Link
                            href={route("genome.report", {
                              subject: person.handle.routeSegment,
                              slug: report.slug,
                            })}
                            className="inline-flex min-h-11 items-center text-base text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest"
                          >
                            {report.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p key={layer} className="text-sm leading-relaxed text-ink">
                    {notShared(person.displayLabel, layer)}
                  </p>
                ),
              )
            )}
            {/* The mandated sentence renders verbatim; the retained term is
                defined beside it on its first occurrence (X4, brief §2 §5.5). */}
            <p data-density-required-accuracy className="max-w-prose text-sm leading-relaxed text-ink">
              {BASELINE_ABSENT}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
              <TermDefinition term="baseline" />
            </p>
          </section>

          {viewerMaySee(person, "ancestry") ? (
            <section aria-labelledby="family-ancestry-heading" className="space-y-2">
              <h2 id="family-ancestry-heading" className="text-lg font-semibold">
                <Link
                  href={route("genome.ancestry", { subject: person.handle.routeSegment })}
                  className="underline-offset-4 hover:underline"
                >
                  {ANCESTRY_HEADING}
                </Link>
              </h2>
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby="family-permissions-heading" className="space-y-2">
        <h2 id="family-permissions-heading" className="text-lg font-semibold">
          <Link
            href={route("family.permissions", { person: person.handle.routeSegment })}
            className="underline-offset-4 hover:underline"
          >
            {PERMISSIONS_HEADING}
          </Link>
        </h2>
      </section>

      <p
        data-density-required-accuracy
        className="max-w-prose text-sm leading-relaxed text-ink-muted"
      >
        {NOT_DIAGNOSTIC}
      </p>
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
    </div>
  );
}
