import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CohortCard } from "@/components/embryo/cohort-card";
import { StandingStatement } from "@/components/embryo/compare/standing-statement";
import { EmbryoEmptyState } from "@/components/embryo/states";
import { EmptyState } from "@/components/site/empty-state";
import { Terrain } from "@/components/site/terrain";
import {
  EMBRYOS_H1,
  EMPTY_HEADING,
  EMPTY_HOW_TO_MAKE_IT_APPEAR,
  EMPTY_WHAT_APPEARS,
  FUTURE_PERSON_LINK,
  HUB_TILES,
  NOT_DIAGNOSTIC,
  REQUEST_DATA_BUTTON,
  WHERE_THIS_WORKS_LINK,
  YOUR_EMBRYOS_HEADING,
} from "@/copy/embryos/index";
import { cohortScopeSegment, copilotGroupScopes } from "@/lib/copilot/group-scopes";
import { EMBRYO_ANALYSIS, cohortCapability, permits } from "@/lib/embryos/access";
import { route } from "@/lib/primary-routes";
import { cn } from "@/lib/utils";
import { loadCohorts, loadViewer } from "./context";

export const metadata: Metadata = { title: EMBRYOS_H1 };

/**
 * `/embryos` — the domain landing (design §2.1; register embryos.index, hub,
 * 64rem, `product-result`). Order: the h1, the empty state or the cohort
 * list, the three tiles, then the standing statement, the availability line
 * and the not-diagnostic line as the hub's footnotes (the same place
 * `/family` keeps them).
 *
 * The viewer's own jurisdiction is read before any cohort row: where it
 * refuses, the page renders the register's copy, blocks every tile and
 * fetches nothing private. Where it permits, each cohort is checked again
 * with every required upload principal (G5.1b). Nothing here ranks, colours
 * or counts an embryo in a way that could read as a verdict.
 */
export default async function EmbryosPage() {
  const viewer = await loadViewer();
  if (!viewer) redirect("/auth/sign-in");
  const { user, decision } = viewer;
  const allowed = permits(decision);

  const cohorts = allowed ? await loadCohorts(user.id) : [];
  const cohortDecisions = new Map(
    await Promise.all(
      cohorts.map(async (cohort) => [cohort.id, await cohortCapability(user.id, cohort, EMBRYO_ANALYSIS)] as const),
    ),
  );
  // The newest cohort the viewer may actually open.
  const newest = cohorts.find((cohort) => permits(cohortDecisions.get(cohort.id)!)) ?? null;

  const tileHref: Record<(typeof HUB_TILES)[number]["id"], string | null> = {
    upload: allowed ? route("embryos.upload") : null,
    compare: allowed && newest ? route("embryos.compare", { query: { cohort: newest.id } }) : null,
    // The cohort scope is designed but not built until embryo publication
    // exists (src/lib/copilot/group-scopes.ts), so the tile states its
    // blocking reason rather than linking to a refused scope.
    copilot:
      allowed && newest && copilotGroupScopes().cohort
        ? route("copilot.scope", { scope: cohortScopeSegment(newest.id) })
        : null,
  };

  return (
    <div
      data-density-primary-content
      data-surface="hub"
      className="page-stack stack-sections max-w-4xl"
    >
      <header className="fam-head">
        <h1 className="display">{EMBRYOS_H1}</h1>
      </header>

      {allowed ? null : (
        <div role="status" data-slot="jurisdiction-line">
          <EmptyState>
            <div className="space-y-3">
              <p className="text-ink">{decision.userFacingCopy}</p>
              <p className="text-sm">
                <Link href={route("legal.future-person")} className="link-target quiet-link">
                  {FUTURE_PERSON_LINK}
                </Link>
              </p>
            </div>
          </EmptyState>
        </div>
      )}

      {!allowed ? null : cohorts.length > 0 ? (
        <section data-density-top-level-section className="space-y-6">
          <h2 className="display">{YOUR_EMBRYOS_HEADING}</h2>
          <ul data-slot="cohort-list" className="space-y-4">
            {cohorts.map((cohort) => {
              const cohortDecision = cohortDecisions.get(cohort.id)!;
              return (
                <CohortCard
                  key={cohort.id}
                  cohort={cohort}
                  jurisdictionCopy={permits(cohortDecision) ? null : cohortDecision.userFacingCopy}
                />
              );
            })}
          </ul>
        </section>
      ) : (
        // The hub's empty state stands on the terrain. <EmbryoEmptyState>
        // takes strings only (src/components/embryo is pinned), so the
        // ground is a layer behind it and the box goes clear (family.css).
        <div data-slot="empty-state-ground-wrap" className="fam-ground">
          <div aria-hidden="true" data-slot="empty-state-ground" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <Terrain variant="ground" seed={11} />
          </div>
          <EmbryoEmptyState
            heading={EMPTY_HEADING}
            whatAppears={EMPTY_WHAT_APPEARS}
            howToMakeItAppear={EMPTY_HOW_TO_MAKE_IT_APPEAR}
            action={{ label: REQUEST_DATA_BUTTON, href: route("embryos.request-data") }}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {HUB_TILES.map((tile) => {
          const href = tileHref[tile.id];
          return (
            <section
              key={tile.id}
              data-slot="embryo-tile"
              data-tile={tile.id}
              className={cn("surface-pad-sm", href ? "surface link-surface fam-tile" : "surface-dashed")}
            >
              <p className={cn("title -my-3", href ? "pr-8 text-ink" : "text-ink-muted")}>
                {href ? (
                  <Link href={href} className="link-target">
                    {tile.label}
                  </Link>
                ) : (
                  <span className="link-target">{tile.label}</span>
                )}
              </p>
              {href ? <span aria-hidden="true" className="link-arrow" /> : null}
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{tile.description}</p>
              {href ? null : (
                <p data-slot="tile-blocked" className="mt-2 text-sm leading-relaxed text-ink">
                  {allowed ? tile.blocked : decision.userFacingCopy}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="space-y-4">
        <StandingStatement tone="quiet" />
        <div className="space-y-2">
          {allowed ? (
            <p data-slot="availability-line" className="caption">
              <Link href={route("legal.where-inherit-works")} className="link-target quiet-link">
                {WHERE_THIS_WORKS_LINK}
              </Link>
            </p>
          ) : null}
          <p data-density-required-accuracy className="caption max-w-measure">
            {NOT_DIAGNOSTIC}
          </p>
        </div>
      </div>
    </div>
  );
}
