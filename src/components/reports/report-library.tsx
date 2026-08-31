"use client";

// Client half of the report library: type-to-filter search plus a sticky
// "On this page" category chip nav. All data is fetched by the server page
// and passed down as serializable props.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export type CoverageStatus = "covered" | "not-covered" | "awaiting";

export interface LibraryCard {
  slug: string;
  title: string;
  summary: string;
  evidenceLabel: string;
  genes: string[];
  status: CoverageStatus;
}

export interface LibraryGroup {
  /** Category slug; doubles as the section's anchor id. */
  id: string;
  label: string;
  cards: LibraryCard[];
}

export function ReportLibrary({
  groups,
  baseHref,
}: {
  groups: LibraryGroup[];
  baseHref: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Right-edge fade on the chip strip, shown only while chips are actually
  // clipped off-screen to the right (hidden once scrolled to the end).
  const navRef = useRef<HTMLElement | null>(null);
  const [clippedRight, setClippedRight] = useState(false);
  const updateClipped = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setClippedRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
  }, []);

  /**
   * Category jump: move scroll AND focus to the section without pushing a
   * history entry per activation (plain hash links made every jump cost a
   * Back press for keyboard users).
   */
  const jumpTo = (e: ReactMouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (!section) return; // fall back to default anchor behavior
    e.preventDefault();
    window.history.replaceState(window.history.state, "", `#${id}`);
    section.scrollIntoView(); // respects the section's scroll-mt
    const heading = document.getElementById(`${id}-heading`);
    (heading ?? section).focus({ preventScroll: true });
  };

  const visible = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        cards: g.label.toLowerCase().includes(q)
          ? g.cards
          : g.cards.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                c.genes.some((gene) => gene.toLowerCase().includes(q)),
            ),
      }))
      .filter((g) => g.cards.length > 0);
  }, [groups, q]);

  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const shown = visible.reduce((n, g) => n + g.cards.length, 0);

  // Re-measure the chip strip when the visible chip set or viewport changes.
  useEffect(() => {
    updateClipped();
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateClipped);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, updateClipped]);

  return (
    <div className="space-y-8">
      <div className="sticky top-0 z-10 -mx-1 space-y-3 border-b border-line bg-paper px-1 pb-3 pt-2">
        <div>
          <label htmlFor="report-search" className="sr-only">
            Search reports by title, gene, or category
          </label>
          <Input
            id="report-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, gene, or category…"
            className="max-w-md bg-card"
          />
          {q ? (
            <p className="mt-1.5 text-xs text-ink-muted" role="status">
              {shown} of {total} reports match
            </p>
          ) : null}
        </div>
        <div className="relative">
          <nav
            ref={navRef}
            onScroll={updateClipped}
            aria-label="On this page"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {visible.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                onClick={(e) => jumpTo(e, g.id)}
                className="shrink-0 whitespace-nowrap rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-muted transition-colors hover:border-forest hover:text-ink"
              >
                {g.label}
              </a>
            ))}
          </nav>
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-r from-transparent to-paper transition-opacity ${
              clippedRight ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </div>

      {visible.map((g) => (
        <section
          key={g.id}
          id={g.id}
          aria-labelledby={`${g.id}-heading`}
          className="scroll-mt-36"
        >
          <h2 id={`${g.id}-heading`} tabIndex={-1} className="eyebrow mb-3">
            {g.label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.cards.map((c) => (
              <li
                key={c.slug}
                className="relative h-full rounded-xl border border-line bg-card p-4 transition-colors focus-within:border-forest hover:border-forest"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {/* The link's accessible name is just title + evidence;
                        the summary stays adjacent, outside the link. */}
                    <Link
                      href={`${baseHref}/${c.slug}`}
                      aria-label={`${c.title}, ${c.evidenceLabel}`}
                      className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      {c.title}
                    </Link>
                  </h3>
                  {/* Evidence is already in the link's accessible name;
                      hide the visual badge from AT so it announces once. */}
                  <Badge
                    variant="secondary"
                    aria-hidden="true"
                    className="shrink-0 text-[10px]"
                  >
                    {c.evidenceLabel}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
                  {c.summary}
                </p>
                <p className="mt-2 text-xs">
                  {c.status === "covered" ? (
                    <span className="text-ok">Covered by your file</span>
                  ) : c.status === "not-covered" ? (
                    <span className="text-ink-muted">
                      Not covered by your file
                    </span>
                  ) : (
                    <span className="text-ink-muted">Awaiting your data</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {q && visible.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No reports match &ldquo;{query}&rdquo;. Try a report title, a gene
          name (e.g. APOE), or a category like &ldquo;Basic traits&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
