import type { ReactNode } from "react";
import { LegalTocRail } from "./toc-rail";

export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

/**
 * Shared layout for legal and policy pages: a reading head (eyebrow, display
 * title, effective date, lede), two anchor tables of contents (a plate on
 * phones, a sticky rail on desktop) and ruled sections on the 68ch measure.
 * Prose styling lives in `src/app/styles/reading.css`. Server component; the
 * rail is the one client child, so it can mark the current section.
 */
export function LegalPage({
  eyebrow,
  title,
  intro,
  effectiveDate,
  version,
  sections,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  /** ISO date, e.g. "2026-08-28". Omit for undated pages. */
  effectiveDate?: string;
  /** The published version of the text, shown next to the effective date. */
  version?: number;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display display-lg">{title}</h1>
        {effectiveDate && (
          <p className="caption">
            Effective{" "}
            <time dateTime={effectiveDate}>
              {new Date(`${effectiveDate}T00:00:00Z`).toLocaleDateString(
                "en-US",
                {
                  timeZone: "UTC",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                },
              )}
            </time>
            {version !== undefined && <> · Version {version}</>}
          </p>
        )}
        {/* The lede carries the measure itself (68ch), so the intro never runs
            wider than the prose below it whatever the column width. */}
        {intro && <div className="lede reading-intro">{intro}</div>}
      </header>

      <details className="legal-toc-plate plate mt-block lg:hidden">
        <summary className="eyebrow">On this page</summary>
        <nav aria-label="On this page">
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
      </details>

      <div className="mt-section lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <LegalTocRail entries={sections.map(({ id, heading }) => ({ id, heading }))} />

        <div className="legal-sections min-w-0">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2 id={`${s.id}-heading`} className="display">
                {s.heading}
              </h2>
              <div className="legal-prose">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
