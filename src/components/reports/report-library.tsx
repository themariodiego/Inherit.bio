"use client";

// Client half of the report library for ONE layer: the search box, the
// sticky "Filter reports" category strip and the per-category "Show all {n}"
// control. All data is fetched by the server page and passed down as
// serializable props. The two layers never share a list container (§4 §1.3);
// the page renders one <ReportLibrary> per layer.

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COVERAGE_PILLS,
  FILTER_REPORTS,
  NO_SEARCH_MATCHES,
  SEARCH_REPORTS_LABEL,
  showAll,
} from "@/copy/reports/strings";
import { route } from "@/lib/primary-routes";
import { cn } from "@/lib/utils";

export type CoverageStatus = keyof typeof COVERAGE_PILLS;

export interface LibraryCard {
  slug: string;
  title: string;
  summary: string;
  evidenceLabel: string;
  /** Gene symbol of every template variant; searched alongside the title. */
  genes: string[];
  status: CoverageStatus;
}

export interface LibraryGroup {
  /** User-facing category id; doubles as the section's anchor id. */
  id: string;
  label: string;
  /** One sentence, ≤15 words. */
  description: string;
  cards: LibraryCard[];
}

export type LibraryLayerClass = "variant-call" | "estimate";

/** A category section shows at most this many cards before "Show all {n}". */
export const CARDS_BEFORE_SHOW_ALL = 12;

/** Case-insensitive substring over the title, each gene symbol and the category label. */
export function cardMatches(card: LibraryCard, categoryLabel: string, needle: string): boolean {
  if (needle === "") return true;
  return (
    card.title.toLowerCase().includes(needle) ||
    card.genes.some((gene) => gene.toLowerCase().includes(needle)) ||
    categoryLabel.toLowerCase().includes(needle)
  );
}

function StatusPill({ status }: { status: CoverageStatus }) {
  return (
    <span
      data-meaning={status === "covered" ? "covered" : status === "not-covered" ? "missing" : undefined}
      data-coverage-status={status}
      className={cn("text-sm", status === "covered" ? "text-ok" : "text-ink-muted")}
    >
      {COVERAGE_PILLS[status]}
    </span>
  );
}

function CardLink({ card, subject }: { card: LibraryCard; subject: string }) {
  // The link's accessible name is title + evidence; the summary stays
  // adjacent, outside the link.
  return (
    <Link
      href={route("genome.report", { subject, slug: card.slug })}
      aria-label={`${card.title}, ${card.evidenceLabel}`}
      className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
    >
      {card.title}
    </Link>
  );
}

/** Estimate cards: two columns (title | evidence), summary, coverage pill. */
function EstimateCard({ card, subject }: { card: LibraryCard; subject: string }) {
  return (
    <li
      data-card="estimate"
      className="relative h-full rounded-xl border border-line bg-card p-4 transition-colors focus-within:border-forest hover:border-forest"
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2">
        <h3 className="text-sm font-medium">
          <CardLink card={card} subject={subject} />
        </h3>
        {/* Evidence is already in the link's accessible name; the visible
            badge is hidden from AT so it announces once. */}
        <Badge variant="secondary" aria-hidden="true" className="shrink-0 text-sm">
          {card.evidenceLabel}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{card.summary}</p>
      <p className="mt-2">
        <StatusPill status={card.status} />
      </p>
    </li>
  );
}

/** Variant-call rows: single column on paper with a line border and a status pill. */
function VariantCallRow({ card, subject }: { card: LibraryCard; subject: string }) {
  return (
    <li
      data-card="variant-call"
      className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-paper px-4 py-3 transition-colors focus-within:border-forest hover:border-forest"
    >
      <h3 className="text-sm font-medium">
        <CardLink card={card} subject={subject} />
      </h3>
      <Badge variant="secondary" aria-hidden="true" className="shrink-0 text-sm">
        {card.evidenceLabel}
      </Badge>
      <p className="w-full text-sm text-ink-muted">{card.summary}</p>
      <p>
        <StatusPill status={card.status} />
      </p>
    </li>
  );
}

export function ReportLibrary({
  groups,
  subject,
  layerClass,
}: {
  groups: LibraryGroup[];
  /** The subject's route segment; every card links to its genome.report route. */
  subject: string;
  layerClass: LibraryLayerClass;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const searchId = "report-search";

  /**
   * Category jump: move scroll AND focus to the section without pushing a
   * history entry per activation (plain hash links made every jump cost a
   * Back press for keyboard users).
   */
  const jumpTo = (e: ReactMouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (!section) return; // fall back to default anchor behaviour
    e.preventDefault();
    window.history.replaceState(window.history.state, "", `#${id}`);
    section.scrollIntoView(); // respects the section's scroll-mt
    const heading = document.getElementById(`${id}-heading`);
    (heading ?? section).focus({ preventScroll: true });
  };

  const expand = (id: string) => {
    setExpanded((current) => new Set([...current, id]));
  };

  // The search filters client-side; an empty query shows everything and a
  // category whose cards all filter out is hidden, chip included.
  const needle = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((g) => ({ ...g, cards: g.cards.filter((card) => cardMatches(card, g.label, needle)) }))
    .filter((g) => g.cards.length > 0);

  const Card = layerClass === "estimate" ? EstimateCard : VariantCallRow;

  return (
    <div data-library-layer={layerClass} className="space-y-8">
      <div className="space-y-1">
        <label htmlFor={searchId} className="block text-sm text-ink-muted">
          {SEARCH_REPORTS_LABEL}
        </label>
        <Input
          id={searchId}
          type="search"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-md bg-card"
        />
      </div>

      {/* The category strip stays a collapsed disclosure at EVERY width: the
          first-viewport interactive budget (≤12, docs/density-baseline.json)
          cannot hold the subject bar (2) + "Why?" (1) + the search box (1) +
          eight category chips + the first row of three cards. */}
      <details className="sticky top-0 z-10 -mx-1 border-b border-line bg-paper px-1 py-2">
        <summary className="cursor-pointer text-sm text-ink-muted">{FILTER_REPORTS}</summary>
        <nav aria-label={FILTER_REPORTS} className="mt-2 flex flex-wrap gap-2 pb-1">
          {visibleGroups.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              onClick={(e) => jumpTo(e, g.id)}
              className="rounded-full border border-line bg-card px-3 py-1 text-sm text-ink-muted transition-colors hover:border-forest hover:text-ink"
            >
              {g.label}
            </a>
          ))}
        </nav>
      </details>

      {needle !== "" && visibleGroups.length === 0 ? (
        <p aria-live="polite" className="text-sm text-ink-muted">
          {NO_SEARCH_MATCHES}
        </p>
      ) : null}

      {/* Adjacent top-level sections keep the baseline gap
          (docs/density-baseline.json adjacentTopLevelSectionGapPx). */}
      <div className="space-y-16 md:space-y-20 lg:space-y-24">
        {visibleGroups.map((g) => {
          const open = expanded.has(g.id);
          // "Show all {n}" counts and reveals the filtered list, never the unfiltered one.
          const visibleCards = open ? g.cards : g.cards.slice(0, CARDS_BEFORE_SHOW_ALL);
          return (
            <section
              key={g.id}
              id={g.id}
              aria-labelledby={`${g.id}-heading`}
              data-density-top-level-section="true"
              className="scroll-mt-24 space-y-3"
            >
              <h2 id={`${g.id}-heading`} tabIndex={-1} className="text-lg font-semibold text-ink">
                {g.label}
              </h2>
              <p className="max-w-prose text-sm text-ink-muted">{g.description}</p>
              <ul
                className={cn(
                  "gap-3",
                  layerClass === "estimate" ? "grid sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col",
                )}
              >
                {visibleCards.map((c) => (
                  <Card key={c.slug} card={c} subject={subject} />
                ))}
              </ul>
              {visibleCards.length < g.cards.length ? (
                <Button type="button" variant="outline" size="sm" onClick={() => expand(g.id)}>
                  {showAll(g.cards.length)}
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
