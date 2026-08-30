import Link from "next/link";
import { Button } from "@/components/ui/button";

const steps = [
  {
    n: "01",
    title: "Find a provider",
    body: "Compare real sequencing providers that ship to you — depth, price, turnaround, and exactly which raw files you get back. You buy from them directly; Inherit never takes a cut of sequencing.",
  },
  {
    n: "02",
    title: "Upload your raw data",
    body: "23andMe, AncestryDNA, MyHeritage, FamilyTreeDNA text files and VCFs are fully processed. BAM/CRAM files are stored and hashed for you. Files go straight to your private storage — never through our page servers.",
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
  "No sequencing sales. We route you to providers; money never passes through us.",
  "No trackers. Zero ad pixels or third-party analytics, verified by an automated network audit in CI.",
  "No data sharing with anyone — including Plus Bio. Separate service, separate accounts, no data flow.",
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-24">
        <p className="eyebrow mb-6">Open-source consumer genomics</p>
        <h1 className="display max-w-3xl text-5xl sm:text-6xl">
          Your genome, <span className="accent">on your terms.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-ink-muted">
          Inherit helps you buy sequencing from a real provider, then turns
          your raw DNA file into reports, ancestry, and polygenic scores
          (combined estimates from many small genetic effects) — on
          infrastructure you can read, audit, and self-host.
        </p>
        <p className="mt-4 max-w-xl text-ink-muted">
          Inherit itself is free — you only ever pay a sequencing provider,
          directly. Already have a DNA file? Everything here costs nothing.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/auth/sign-up">Start with your raw data</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/providers">Find a sequencing provider</Link>
          </Button>
        </div>
      </section>

      <section className="border-y border-line bg-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow mb-10">How it works</p>
          <ol className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n}>
                <span className="display text-4xl text-forest">{s.n}</span>
                <h2 className="mt-3 font-medium">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <p className="eyebrow mb-6">Plain terms</p>
            <h2 className="display text-4xl">
              What we <span className="accent">won&apos;t</span> do.
            </h2>
            <ul className="mt-8 space-y-4">
              {candor.map((c) => (
                <li key={c} className="flex gap-3 text-sm leading-relaxed">
                  <span
                    aria-hidden
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-forest"
                  />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-line pt-6 text-sm leading-relaxed text-ink-muted">
              How is that possible? Created and funded by Plus Bio as a
              public-good project — Inherit has no revenue model and nothing
              to sell.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-6">
            <p className="eyebrow mb-4">Sample report</p>
            <h3 className="font-medium">Caffeine metabolism · CYP1A2</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Variant</dt>
                <dd className="font-mono">rs762551</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Your genotype</dt>
                <dd className="font-mono">A/A</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Interpretation</dt>
                <dd className="text-right">Faster caffeine metabolizer</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Evidence</dt>
                <dd>
                  <span className="rounded-full bg-tint px-2.5 py-0.5 text-xs">
                    Moderate · 2 studies
                  </span>
                </dd>
              </div>
            </dl>
            <p className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">
              Informational, not medical advice. Every report carries its
              citations and an honest coverage state for your file.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
