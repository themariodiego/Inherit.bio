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
      className="surface-inset surface-pad space-y-4"
    >
      <h2 id="support-panel-title" className="title text-ink">
        If this result concerns you
      </h2>
      <p className="max-w-measure text-base leading-relaxed text-ink">
        You do not have to make sense of this result alone. A genetic counselor
        can explain this raw-data result and whether a medical test may help.
        Talking it through can help even if the result is good news.
      </p>
      {carrier ? (
        <p className="max-w-measure text-base leading-relaxed text-ink">
          Carrier results are most useful when both partners are tested. If you
          plan to have children, your partner can be tested too. A counselor
          can explain what both results mean.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a
          href="https://findageneticcounselor.nsgc.org"
          target="_blank"
          rel="noopener noreferrer"
          className="link-target prose-link text-sm"
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
