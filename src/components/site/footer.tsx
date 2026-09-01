import Link from "next/link";
import { Attribution, Wordmark } from "./wordmark";

const columns: { heading: string; links: { href: string; label: string }[] }[] =
  [
    {
      heading: "Product",
      links: [
        { href: "/providers", label: "Find a provider" },
        { href: "/overview", label: "Overview" },
        { href: "/changelog", label: "Research changelog" },
        { href: "/legal/self-hosting", label: "Self-host" },
      ],
    },
    {
      heading: "Trust",
      links: [
        { href: "/privacy", label: "Privacy policy" },
        { href: "/terms", label: "Terms of service" },
        { href: "/legal/research-consent", label: "Research consent" },
        { href: "/legal/law-enforcement", label: "Law enforcement & transparency" },
        { href: "/about#accessibility", label: "Accessibility" },
      ],
    },
    {
      heading: "Company",
      links: [
        { href: "/about", label: "About & the Plus Bio relationship" },
        { href: "/legal/gina", label: "GINA, explained" },
        { href: "/legal/deceased", label: "Deceased customers" },
        {
          href: "https://github.com/themariodiego/Inherit.bio",
          label: "Source code (AGPL-3.0)",
        },
      ],
    },
  ];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Wordmark />
          <p className="max-w-xs text-sm text-ink-muted">
            Your genome, on your terms. Inherit never sells sequencing, never
            sells your data, and runs on code you can read.
          </p>
          <Attribution />
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="eyebrow mb-4">{col.heading}</h2>
            <ul className="space-y-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith("http") ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink-muted hover:text-ink"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      href={l.href}
                      className="text-ink-muted hover:text-ink"
                    >
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-ink-muted">
          <p>
            Informational only — not medical advice, not a diagnostic service.
          </p>
          <p>AGPL-3.0 · no trackers, no ad pixels, no third-party analytics</p>
        </div>
      </div>
    </footer>
  );
}
