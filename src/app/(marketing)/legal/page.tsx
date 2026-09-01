import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Legal and trust" };

const links = [
  ["/terms", "Terms"], ["/privacy", "Privacy"], ["/legal/consents", "Consent architecture"],
  ["/legal/future-person", "Future Person Charter"], ["/legal/insurance-and-discrimination", "Insurance and discrimination"],
  ["/legal/gdpr", "GDPR"], ["/legal/incident-response", "Incident response"],
  ["/legal/where-inherit-works", "Where Inherit works"], ["/legal/self-hosting", "Self-hosting"],
] as const;

export default function LegalIndexPage() {
  return <div className="mx-auto max-w-4xl px-6 py-16"><p className="eyebrow">Trust</p><h1 className="display mt-4 text-4xl">Legal and policy library</h1><ul className="mt-10 grid gap-3 sm:grid-cols-2">{links.map(([href, label]) => <li key={href}><Link href={href} className="block rounded-xl border border-line bg-card p-4 hover:border-forest">{label}</Link></li>)}</ul></div>;
}
