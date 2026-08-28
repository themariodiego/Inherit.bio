import type { ReactNode } from "react";

export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

/**
 * Shared layout for legal and policy pages: title, effective date,
 * anchor table of contents, and prose styling via Tailwind selectors
 * (no typography plugin). Server component, no client JS.
 */
export function LegalPage({
  eyebrow,
  title,
  intro,
  effectiveDate,
  sections,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  /** ISO date, e.g. "2026-08-28". Omit for undated pages. */
  effectiveDate?: string;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="max-w-3xl">
        <p className="eyebrow mb-4">{eyebrow}</p>
        <h1 className="display text-4xl sm:text-5xl">{title}</h1>
        {effectiveDate && (
          <p className="mt-4 text-sm text-ink-muted">
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
          </p>
        )}
        {intro && (
          <div className="mt-5 space-y-4 leading-relaxed text-ink-muted">
            {intro}
          </div>
        )}
      </header>

      <div className="mt-12 gap-12 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="mb-10 lg:mb-0">
          <div className="lg:sticky lg:top-24">
            <p className="eyebrow mb-4">On this page</p>
            <ol className="space-y-2.5 border-l border-line pl-4 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-ink-muted hover:text-ink"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="max-w-3xl">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-24 border-t border-line py-8 first:border-t-0 first:pt-0 last:pb-0"
            >
              <h2 className="display text-2xl">{s.heading}</h2>
              <div className="mt-4 space-y-4 text-sm leading-relaxed text-ink-muted [&_a:hover]:text-ink [&_a]:underline [&_a]:underline-offset-2 [&_h3]:pt-2 [&_h3]:font-medium [&_h3]:text-ink [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
