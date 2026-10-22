import type { ReactNode } from "react";

export interface LegalSection {
  id: string;
  heading: string;
  /** The h2's markup when the heading needs a no-wrap span; same words. */
  headingDisplay?: ReactNode;
  body: ReactNode;
}

/**
 * Shared layout for legal and policy pages: a reading head (eyebrow, display
 * title, effective date, lede), one native navigation disclosure and ruled
 * sections on the 68ch measure. Only navigation is collapsed: every policy,
 * consent and safety paragraph stays in the ordinary page flow.
 * Prose styling lives in `src/app/styles/reading.css`. Server component.
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
        <h1 className="display">{title}</h1>
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

      <details className="mt-block">
        <summary className="eyebrow min-h-11 w-fit cursor-pointer content-center">On this page</summary>
        {/* The list keeps the prose measure: its entries are one heading each,
            and a column wider than 68ch is a measure breach (brief X6.3). */}
        <nav aria-label="On this page">
          <ol className="mt-2 flex max-w-measure flex-col gap-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a className="link-target" href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
      </details>

      <div className="mt-section">
        <div className="legal-sections min-w-0">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2 id={`${s.id}-heading`} className="display">
                {s.headingDisplay ?? s.heading}
              </h2>
              <div className="legal-prose">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
