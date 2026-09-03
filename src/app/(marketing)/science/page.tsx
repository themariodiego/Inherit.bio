import type { Metadata } from "next";
import Link from "next/link";
import { EVIDENCE_DEFINITIONS, EVIDENCE_PUBLIC_LABELS } from "@/copy/reports/evidence";
import { EVIDENCE_LEVELS } from "@/lib/genome/taxonomy";

export const metadata: Metadata = { title: "Science" };

// The two anchors below are link targets from every report page: the
// evidence chip resolves to /science#evidence and the reports list's
// "{k} of these reports cannot give you a number yet. Why?" resolves to
// /science#polygenic (brief §4 §2.7, §4 §8.4). Labels and definitions come
// from their one home in src/copy/reports/evidence.ts.

export default function SciencePage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="eyebrow">Science</p><h1 className="display mt-4 text-4xl">What Inherit can—and cannot—say.</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted">Reports use only the DNA positions found in your file and public sources with version numbers. Inherit does not guess missing results or treat a link found in a study as a diagnosis.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Link href="/science/limits" className="rounded-2xl border border-line bg-card p-5 hover:border-forest"><h2 className="font-medium">Limits and uncertainty</h2><p className="mt-2 text-sm text-ink-muted">Coverage, reference populations, and resolution.</p></Link>
        <Link href="/science/positions" className="rounded-2xl border border-line bg-card p-5 hover:border-forest"><h2 className="font-medium">Positions and builds</h2><p className="mt-2 text-sm text-ink-muted">How observed variants are normalized to GRCh38.</p></Link>
      </div>

      <section id="evidence" aria-labelledby="evidence-heading" className="mt-16 scroll-mt-24">
        <h2 id="evidence-heading" className="display text-2xl">How sure we are</h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">Every report carries one of these words. Each word says how well the science behind the report has been checked.</p>
        <dl className="mt-6 space-y-3">
          {EVIDENCE_LEVELS.map((level) => (
            <div key={level} className="rounded-2xl border border-line bg-card p-5">
              <dt className="font-medium">{EVIDENCE_PUBLIC_LABELS[level]}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{EVIDENCE_DEFINITIONS[level]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="polygenic" aria-labelledby="polygenic-heading" className="mt-16 scroll-mt-24">
        <h2 id="polygenic-heading" className="display text-2xl">Why a report may show no number yet</h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">Some reports add up many small effects into one estimate. Scientists call these polygenic scores.</p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">To turn that estimate into a number for you, Inherit needs to know how the model behaves in people like you. Where that check has not been done, the report shows your two letters and says so. It never shows a number that could be wrong.</p>
      </section>
    </div>
  );
}
