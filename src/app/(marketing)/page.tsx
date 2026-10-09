import type { CSSProperties } from "react";
import Link from "next/link";
import { BookOpen, Fingerprint, LockKeyhole } from "lucide-react";
import { Terrain } from "@/components/site/terrain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { route } from "@/lib/primary-routes";
import { cn } from "@/lib/utils";

const guide = [
  {
    icon: BookOpen,
    label: "Reports, with context",
    body: "What your file shows. Where the evidence comes from. What it cannot tell you.",
  },
  {
    icon: Fingerprint,
    label: "Explore your ancestry",
    body: "See the regions your file supports, with its limits in view.",
  },
  {
    icon: LockKeyhole,
    label: "Your data, your choice",
    body: "Export, delete, or run Inherit yourself. The code is open to read.",
  },
];

const steps = [
  {
    n: "01",
    title: "Find a provider",
    body: "Compare labs that ship to you. See depth, price, timing, and which raw files you get. You pay each lab directly. A clearly marked affiliate link may earn Inherit a commission without changing your price.",
  },
  {
    n: "02",
    title: "Upload your raw data",
    body: "Upload 23andMe, AncestryDNA, MyHeritage or FamilyTreeDNA text files, or VCF/gVCF files. Choose which reports to generate after your file is prepared. BAM, CRAM and FASTQ files are not accepted. Uploads go straight from your browser to private storage.",
  },
  {
    n: "03",
    title: "Read what your file actually supports",
    body: "Reports state their evidence, cite their sources, and say plainly when your file doesn't cover a variant. Coverage is a number here, never a slogan.",
  },
  {
    n: "04",
    title: "Ask, explore, export, delete",
    body: "Search variants, browse your genome, chat with an AI that cites your own reports — locally if you prefer. Export everything free, forever. Deletion actually deletes.",
  },
];

const candor = [
  "No diagnosis. Inherit is informational, not a medical device.",
  "No sequencing sales. We route you to labs, which you pay directly.",
  "No trackers. Zero ad pixels or third-party analytics, verified by an automated network audit in CI.",
  "No data sharing with anyone — including Plus Bio. Separate service, separate accounts, no data flow.",
];

/** Stagger index for `.rise`: each hero block lands 40ms after the last. */
const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div aria-hidden="true" className="hero-ground">
          <div className="terrain-glow" />
        </div>
        <div className="hero-content mx-auto w-full max-w-6xl px-6 pt-12 pb-8 md:pt-20 md:pb-10">
          <p className="eyebrow rise" style={stagger(0)}>
            Open-source consumer genomics
          </p>
          <h1 className="display display-hero rise mt-6" style={stagger(1)}>
            Your genome, <span className="accent-italic">on your terms.</span>
          </h1>
          <p className="lede rise mt-8" style={stagger(2)}>
            Turn your raw DNA file into reports and ancestry results. Read the
            evidence, see what your file covers, and keep control of your data.
          </p>
          <p className="rise mt-4 max-w-measure text-base text-ink-muted" style={stagger(3)}>
            Inherit itself is free — you only ever pay a sequencing provider,
            directly. Already have a DNA file? Everything here costs nothing.
          </p>
          <div className="rise mt-10 flex flex-wrap gap-3" style={stagger(4)}>
            <Button asChild size="lg">
              <Link href="/auth/sign-up">Start with your raw data</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={route("marketing.providers")}>Find a sequencing provider</Link>
            </Button>
          </div>
        </div>
        {/* The hills start below the action row (the content's bottom padding
            is the clear paper between them), so no ridge crosses a button. */}
        <div aria-hidden="true" className="hero-band">
          <Terrain variant="hero" />
        </div>
      </section>

      <aside aria-label="About Inherit" className="mx-auto max-w-6xl px-6 pt-section">
        <p className="eyebrow eyebrow-rule">A guide to your DNA</p>
        {/* Three plates: 2-up at md with the third across the row, 3-up at lg. */}
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {guide.map((g, i) => (
            <div key={g.label} className={cn("plate", i === guide.length - 1 && "md:col-span-2 lg:col-span-1")}>
              <div className="plate-head">
                <p className="flex items-center gap-2.5">
                  <g.icon aria-hidden="true" className="size-5 shrink-0 text-forest" />
                  <span className="eyebrow">{g.label}</span>
                </p>
              </div>
              <div className="plate-body">
                <p className="max-w-measure text-sm text-ink">{g.body}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="mt-section border-y border-line bg-card">
        <div className="mx-auto max-w-6xl px-6 py-section">
          <p className="eyebrow eyebrow-rule">How it works</p>
          <ol className="mt-10 grid items-start gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="step">
                <span className="ordinal">{s.n}</span>
                <h2 className="title mt-5">{s.title}</h2>
                <p className="mt-2 max-w-measure text-sm text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-section">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Plain terms</p>
            <h2 className="display display-2 mt-6">
              What we <span className="accent">won&apos;t</span> do.
            </h2>
            <ul className="candor mt-8">
              {candor.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="rule-forest mt-8 max-w-measure pt-6 text-sm text-ink-muted">
              Plus Bio created and funds this public-good project. The core
              software is free. Some marked provider links may earn a
              commission, but Inherit does not sell DNA tests or your data.
            </p>
          </div>
          <div className="plate lg:sticky lg:top-24">
            <div className="plate-head">
              <p className="eyebrow">Sample report</p>
            </div>
            <div className="plate-body">
              <h3 className="title">Caffeine metabolism · CYP1A2</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Variant</dt>
                  <dd className="tabular text-ink">rs762551</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Your genotype</dt>
                  <dd className="tabular text-ink">A/A</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Interpretation</dt>
                  <dd className="text-right">Faster caffeine metabolizer</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-ink-muted">Evidence</dt>
                  <dd>
                    <Badge variant="outline">Moderate · 2 studies</Badge>
                  </dd>
                </div>
              </dl>
              <p className="caption rule mt-5 max-w-measure pt-4">
                Informational, not medical advice. Every report carries its
                citations and an honest coverage state for your file.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
