import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Science" };

export default function SciencePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="eyebrow">Science</p><h1 className="display mt-4 text-4xl">What Inherit can—and cannot—say.</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted">Reports use only the DNA positions found in your file and public sources with version numbers. Inherit does not guess missing results or treat a link found in a study as a diagnosis.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/science/limits" className="rounded-2xl border border-line bg-card p-5 hover:border-forest"><h2 className="font-medium">Limits and uncertainty</h2><p className="mt-2 text-sm text-ink-muted">Coverage, reference populations, and resolution.</p></Link>
        <Link href="/science/positions" className="rounded-2xl border border-line bg-card p-5 hover:border-forest"><h2 className="font-medium">Positions and builds</h2><p className="mt-2 text-sm text-ink-muted">How observed variants are normalized to GRCh38.</p></Link>
      </div>
    </div>
  );
}
