import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Count } from "@/components/reports/count";
import { STARTER } from "@/copy/overview";
import { LAYER_LABELS } from "@/copy/reports/strings";
import type { ReportTemplate } from "@/lib/genome/reports";
import { route } from "@/lib/primary-routes";
import { groupStarterReports } from "./starter";

/** §7.2 words per homogeneous group; X5.1 forbids a mixed starter total. */
export function StarterReports({ reports }: { reports: readonly ReportTemplate[] }) {
  const groups = groupStarterReports(reports);
  if (groups.length === 0) return (
    <section aria-labelledby="starter-title" data-density-top-level-section className="max-w-measure">
      <p id="starter-title" className="title text-ink">{STARTER.none}</p>
    </section>
  );
  return groups.map(({ layer, reports }, index) => {
    const titleId = index === 0 ? "starter-title" : `starter-title-${layer}`;
    const definitionId = layer === "estimate" ? "overview-estimate-definition" : "overview-variant-call-definition";
    return (
      <section key={layer} aria-labelledby={titleId} data-starter-layer={layer}
        data-density-top-level-section className="max-w-measure">
        <p id={titleId} className="title text-ink">
          <Count value={reports.length} layerClass={layer === "estimate" ? "estimate" : "variant-call"}
            wording="starter" describedBy={definitionId} />
        </p>
        {/* The layer label sits in the section's running text beside the
            title, so it stays `display: inline` (SC 2.5.8 Inline). */}
        <a href={`#${definitionId}`} className="prose-link text-sm">
          {LAYER_LABELS[layer]}
        </a>
        <ol className="mt-5 divide-y divide-line border-y border-line">
          {reports.map((template) => (
            <li key={template.slug}>
              <Link href={route("genome.report", { subject: "me", slug: template.slug })}
                className="link-row flex min-h-row items-center justify-between gap-4 py-2 text-base text-ink">
                <span>{template.title}</span>
                <ArrowUpRight aria-hidden="true" className="link-arrow size-4 shrink-0 text-forest" />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    );
  });
}
