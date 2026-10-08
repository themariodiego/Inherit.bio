import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LEGAL_INDEX_RIGHTS } from "@/copy/navigation";

export const metadata: Metadata = { title: "Legal and trust" };

// The register's rights entries on the legal index come first, as their own
// group above a hairline; the policies follow.
const rights = LEGAL_INDEX_RIGHTS.map(({ href, label }) => [href, label] as const);
const policies = [
  ["/terms", "Terms"], ["/privacy", "Privacy"], ["/legal/consents", "Consent architecture"],
  ["/legal/future-person", "Future Person Charter"], ["/legal/insurance-and-discrimination", "Insurance and discrimination"],
  ["/legal/gdpr", "GDPR"], ["/legal/incident-response", "Incident response"],
  ["/legal/where-inherit-works", "Where Inherit works"], ["/legal/self-hosting", "Self-hosting"],
] as const;

function LegalRow({ href, label }: { href: string; label: string }) {
  return (
    <li className="surface link-surface relative flex min-h-row items-center gap-4 pr-4 pl-5">
      <Link href={href} className="link-target label flex-1 self-stretch text-ink after:absolute after:inset-0 after:content-['']">{label}</Link>
      <ArrowUpRight aria-hidden="true" className="link-arrow size-4 shrink-0 text-forest" />
    </li>
  );
}

export default function LegalIndexPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Trust</p>
        <h1 className="display display-lg">Legal and policy library</h1>
      </header>
      {/* Each row is a 56px surface; the anchor fills the row and is
          stretched over it, carrying only its label text. The arrow marks a
          whole-row link and sits outside the anchor. */}
      <div className="mt-section">
        <ul className="grid gap-4 sm:grid-cols-2">
          {rights.map(([href, label]) => (
            <LegalRow key={href} href={href} label={label} />
          ))}
        </ul>
        <ul className="rule mt-8 grid gap-4 pt-8 sm:grid-cols-2">
          {policies.map(([href, label]) => (
            <LegalRow key={href} href={href} label={label} />
          ))}
        </ul>
      </div>
    </div>
  );
}
