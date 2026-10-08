import Link from "next/link";
import { Attribution, Wordmark } from "./wordmark";
import { route } from "@/lib/primary-routes";
import { PUBLIC_RIGHTS_FOOTER, PUBLIC_RIGHTS_FOOTER_HEADING } from "@/copy/navigation";

const columns: { heading: string; links: { href: string; label: string }[] }[] =
  [
    {
      // The register's persistent public footer: each rights route one action
      // from any public page, for a person who holds no account.
      heading: PUBLIC_RIGHTS_FOOTER_HEADING,
      links: PUBLIC_RIGHTS_FOOTER.map(({ href, label }) => ({ href, label })),
    },
    {
      heading: "Product",
      links: [
        { href: route("marketing.providers"), label: "Find a provider" },
        { href: route("app.overview"), label: "Overview" },
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
      <div className="mx-auto max-w-6xl px-6">
        {/* Top band: the mark at display size, the one sentence, the
            attribution. Hairlines separate the three bands; no fills. From
            lg the mark shares the attribution's baseline. */}
        <div className="grid gap-6 py-10 md:py-16 lg:grid-cols-[auto_1fr] lg:items-baseline-last lg:gap-16">
          <Wordmark className="text-3xl md:text-5xl" />
          <div className="space-y-4">
            <p className="lede">
              Your genome, on your terms. Inherit never sells sequencing, never
              sells your data, and runs on code you can read.
            </p>
            <Attribution />
          </div>
        </div>
        {/* Two columns from 320px so a phone is not mostly footer (the longest
            labels wrap to two or three lines in a 124px column); four from
            lg. Every entry stays a 44px target. */}
        <div className="rule grid grid-cols-2 gap-x-6 gap-y-8 py-10 md:py-12 lg:grid-cols-4">
          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="eyebrow mb-4">{col.heading}</h2>
              {/* Each entry is a tap target, not a line of prose: SC 2.5.8's
                  Inline exception covers a link inside a sentence, and a
                  footer column is a stack of links with no sentence around
                  them. So every one carries the control scale (44px tall,
                  the whole column row wide) and `space-y-2` is the 8px
                  separation. */}
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("http") ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="site-footer-link"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="site-footer-link">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="rule flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-6">
          <p className="caption">
            Informational only — not medical advice, not a diagnostic service.
          </p>
          <p className="caption">AGPL-3.0 · no trackers, no ad pixels, no third-party analytics</p>
        </div>
      </div>
    </footer>
  );
}
