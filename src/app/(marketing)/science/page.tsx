import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { EVIDENCE_DEFINITIONS, EVIDENCE_PUBLIC_LABELS } from "@/copy/reports/evidence";
import { EVIDENCE_LEVELS } from "@/lib/genome/taxonomy";
import { ClaimSources } from "@/components/claims/sources";
import { presentationCitations } from "@/lib/claims/presentation";

export const metadata: Metadata = { title: "Science" };

// Two anchors below are link targets from every report page: the
// evidence chip resolves to /science#evidence and the reports list's
// "{k} of these reports cannot give you a number yet. Why?" resolves to
// /science#polygenic (brief §4 §2.7, §4 §8.4). Labels and definitions come
// from their one home in src/copy/reports/evidence.ts. The third anchor,
// #not-offered, publishes the declared gaps (brief X15).

export default function SciencePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Science</p>
        <h1 className="display display-lg">What Inherit can—and cannot—say.</h1>
        <p className="lede reading-intro">Reports use only the DNA positions found in your file and public sources with version numbers. Inherit does not guess missing results or treat a link found in a study as a diagnosis.</p>
      </header>
      <div className="mt-section stack-sections">
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/science/limits" className="surface link-surface surface-pad-sm flex items-start justify-between gap-4 text-ink">
            <div>
              <h2 className="title">Limits and uncertainty</h2>
              <p className="mt-2 text-sm text-ink-muted">Coverage, reference populations, and resolution.</p>
            </div>
            <ArrowUpRight aria-hidden="true" className="link-arrow mt-1 size-4 shrink-0 text-forest" />
          </Link>
          <Link href="/science/positions" className="surface link-surface surface-pad-sm flex items-start justify-between gap-4 text-ink">
            <div>
              <h2 className="title">Positions and builds</h2>
              <p className="mt-2 text-sm text-ink-muted">How observed variants are normalized to GRCh38.</p>
            </div>
            <ArrowUpRight aria-hidden="true" className="link-arrow mt-1 size-4 shrink-0 text-forest" />
          </Link>
        </div>

        <section id="evidence" aria-labelledby="evidence-heading" className="scroll-mt-24 border-t border-line pt-block">
          <h2 id="evidence-heading" className="display">How sure we are</h2>
          <p className="lede mt-4">Every report carries one of these words. Each word says how well the science behind the report has been checked.</p>
          <dl className="mt-8 grid gap-4 md:grid-cols-2">
            {EVIDENCE_LEVELS.map((level) => (
              <div key={level} className="surface surface-pad-sm">
                <dt className="title">{EVIDENCE_PUBLIC_LABELS[level]}</dt>
                <dd className="mt-2 max-w-measure text-ink">{EVIDENCE_DEFINITIONS[level]}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* X15 declared gaps: the two category services Inherit does not offer
            are stated here, once, with the reason. The third (Denisovan
            ancestry) is stated on the ancestry surface beside the Neanderthal
            card. docs/capability-register.md is the authority. */}
        <section id="not-offered" aria-labelledby="not-offered-heading" className="scroll-mt-24 border-t border-line pt-block">
          <h2 id="not-offered-heading" className="display">What Inherit does not do</h2>
          <div className="legal-prose mt-6">
            <p>Inherit does not match you with relatives. It does not work out how much DNA two people share. Your file is compared with public reference data, not with another person’s file.</p>
            <p>Inherit does not offer prenatal or newborn screening. Those are clinical tests with their own rules, and a clinic is the right place for them.</p>
          </div>
        </section>

        <section id="sources" aria-labelledby="sources-heading" className="scroll-mt-24 border-t border-line pt-block">
          <h2 id="sources-heading" className="display">Sources checked for these reports</h2>
          <p className="lede mt-4 mb-8">This list covers linked explanations in selected reports, including taste, smell, earwax and sneezing in bright light. Other reports still list their sources on their own pages. This is not a complete review of the report library.</p>
          <ClaimSources sourceIds={presentationCitations.map((source) => source.id)} scienceIndex />
        </section>

        <section id="polygenic" aria-labelledby="polygenic-heading" className="scroll-mt-24 border-t border-line pt-block">
          <h2 id="polygenic-heading" className="display">Why a report may show no number yet</h2>
          <div className="legal-prose mt-6">
            <p>Some reports add up many small effects into one estimate. Scientists call these polygenic scores.</p>
            <p>To turn that estimate into a number for you, Inherit needs to know how the model behaves in people like you. Where that check has not been done, the report shows your two letters and says so. It never shows a number that could be wrong.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
