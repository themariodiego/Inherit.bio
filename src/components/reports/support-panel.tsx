"use client";

// "If this result concerns you" — a calm support pathway shown after the
// result on sensitive and carrier-style reports: genetic-counselor
// directory link, partner-testing note for carrier reports, and a
// print/save action for bringing the report to an appointment.

import { Button } from "@/components/ui/button";

export function SupportPanel({ carrier }: { carrier: boolean }) {
  return (
    <section
      data-testid="support-panel"
      aria-labelledby="support-panel-title"
      className="rounded-2xl border border-line bg-card p-5"
    >
      <h2 id="support-panel-title" className="font-medium">
        If this result concerns you
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        You don&apos;t have to work out what it means on your own. A genetic
        counselor can put a raw-data result like this one in context —
        including whether clinical-quality testing would add anything — and
        talking it through is worthwhile even when the answer turns out to be
        reassuring.
      </p>
      {carrier ? (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
          Carrier results are most informative as a pair: if family planning
          is relevant, your partner can be tested too, and a counselor can
          walk you both through what the combination would mean.
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <a
          href="https://findageneticcounselor.nsgc.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-2"
        >
          Find a genetic counselor (NSGC directory)
        </a>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => window.print()}
        >
          Print or save this report
        </Button>
      </div>
    </section>
  );
}
