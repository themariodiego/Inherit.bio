import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LEGAL_INDEX_RIGHTS } from "@/copy/navigation";

export const metadata: Metadata = { title: "Legal and trust" };

const links = [
  // The register's rights entries on the legal index come first.
  ...LEGAL_INDEX_RIGHTS.map(({ href, label }) => [href, label] as const),
  ["/terms", "Terms"], ["/privacy", "Privacy"], ["/legal/consents", "Consent architecture"],
  ["/legal/future-person", "Future Person Charter"], ["/legal/insurance-and-discrimination", "Insurance and discrimination"],
  ["/legal/gdpr", "GDPR"], ["/legal/incident-response", "Incident response"],
  ["/legal/where-inherit-works", "Where Inherit works"], ["/legal/self-hosting", "Self-hosting"],
] as const;

export default function LegalIndexPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Trust</p>
        <h1 className="display display-lg">Legal and policy library</h1>
      </header>
      <ul className="mt-section grid gap-4 sm:grid-cols-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="surface link-surface flex min-h-row items-center justify-between gap-4 px-5 py-3 text-ink">
              <span className="label">{label}</span>
              <ArrowUpRight aria-hidden="true" className="link-arrow size-4 shrink-0 text-forest" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
