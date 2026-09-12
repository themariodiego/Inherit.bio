import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { Button } from "@/components/ui/button";
import { NAV_LABELS } from "@/copy/navigation";
import { ADD_A_FILE, NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { getSubjectFileCount, hasFileInPreparation } from "@/lib/genome/load";
import { HUB_PREPARING } from "@/copy/genome/preparation";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { CapabilityUnavailable } from "@/components/capability-unavailable";
import { viewerMaySee } from "@/lib/family/access";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { redirect } from "next/navigation";

const DOMAIN_LABEL = NAV_LABELS["my-genome"];

/**
 * The hub resolves a FAMILY segment as well as an own one (operator decision,
 * 2026-09-12), so the three `/genome/[subject]` routes behave as one surface.
 * Until then this page used `resolveSubjectForAccount` while its children were
 * being moved to `resolveSubjectRoute`, which would have left a person landing
 * on a not-found parent above pages that worked.
 *
 * `anyOf` is every purpose a tile below could open. A relative who has shared
 * nothing this page can lead to answers exactly like an unknown record, so the
 * hub is never a place to discover that a record exists.
 */
const loadSubject = cache((segment: string) =>
  resolveSubjectRoute(segment, { anyOf: ["reports.monogenic", "reports.polygenic", "ancestry"] }));

export async function generateMetadata(
  props: PageProps<"/genome/[subject]">,
): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  return {
    title: context.kind === "ok" ? `${context.displayLabel} · ${context.domain.label}` : DOMAIN_LABEL,
  };
}

export default async function GenomePage(
  props: PageProps<"/genome/[subject]">,
) {
  const { subject: segment } = await props.params;
  const context = await loadSubject(segment);
  if (context.kind === "not-found") notFound();
  if (context.kind === "gate") {
    redirect(route("family.person", { person: context.personSegment }));
  }
  if (context.kind === "jurisdiction") {
    return (
      <CapabilityUnavailable
        eyebrow={NAV_LABELS.family}
        title={DOMAIN_LABEL}
        backHref={route("family.index")}
      />
    );
  }
  const { user, subject, dataSubjectId, person, domain, displayLabel } = context;
  // The subject bar counts every file in the record, whatever its status.
  // `preparing` is a narrower question and a different sentence: a rejected
  // or retired file is counted above and is no reason to say results are
  // coming.
  const admin = createAdminClient();
  const [fileCount, preparing] = await Promise.all([
    getSubjectFileCount(admin, dataSubjectId),
    hasFileInPreparation(admin, dataSubjectId),
  ]);
  const subjectParams = { subject: subject.routeSegment };

  // A tile opens only what this record can actually serve THIS viewer. For an
  // own record that is everything; for a relative it is what they granted, and
  // a tile they did not grant is absent rather than a link to a 404.
  //
  // The copy changes with it, and that is not decoration. Every line here was
  // written in the second person — "your file", "your own reports" — which
  // becomes a false sentence the moment the record belongs to someone else.
  const mine = person === null;
  const tiles = [
    ...(mine || viewerMaySee(person, "reports.monogenic") || viewerMaySee(person, "reports.polygenic")
      ? [{ href: route("genome.reports", subjectParams), title: "Reports",
          copy: mine ? "Each report says what your file shows and what it cannot tell you."
            : `Each report says what ${displayLabel}’s file shows and what it cannot tell you.` }]
      : []),
    ...(mine || viewerMaySee(person, "ancestry")
      ? [{ href: route("genome.ancestry", subjectParams), title: "Ancestry",
          copy: mine ? "What your file supports about broad regions and parent lines."
            : `What ${displayLabel}’s file supports about broad regions and parent lines.` }]
      : []),
    // Copilot is own-record only. `/copilot/[scope]` reads the viewer's own
    // subjects, so an `s-{person}` scope does not resolve there yet — the
    // Family hub says the same thing about its own Copilot tile.
    ...(mine
      ? [{ href: route("copilot.scope", { scope: subject.routeSegment }), title: "Copilot",
          copy: "Ask questions about your own reports in plain language." }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs items={[{ label: domain.label, href: domain.href }, { label: displayLabel }]} />
      <SubjectBar subject={subject} fileCount={fileCount} viewerAccountId={user.id} />
      <h1 className="display text-3xl">{domain.label}</h1>
      {preparing ? (
        <p role="status" className="max-w-prose text-sm leading-relaxed text-ink">{HUB_PREPARING}</p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Genome tools">
        {tiles.map((tile) => (
          <article key={tile.href} className="flex flex-col rounded-2xl border border-line bg-card p-5">
            <h2 className="display text-2xl">{tile.title}</h2>
            <p className="mt-2 flex-1 text-base leading-relaxed text-ink-muted">{tile.copy}</p>
            <Button asChild variant="outline" className="mt-5">
              <Link href={tile.href}>Open {tile.title}</Link>
            </Button>
          </article>
        ))}
      </section>
      {mine ? (
        <Button asChild>
          <Link href={route("files.upload", { query: { subject: subject.routeSegment } })}>{ADD_A_FILE}</Link>
        </Button>
      ) : null}
      <p className="max-w-prose text-sm text-ink-muted">{NOT_DIAGNOSTIC}</p>
    </div>
  );
}
