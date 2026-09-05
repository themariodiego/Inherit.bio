import Link from "next/link";
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
    <section aria-labelledby="starter-title" data-density-top-level-section className="max-w-prose">
      <p id="starter-title" className="text-lg font-semibold">{STARTER.none}</p>
    </section>
  );
  return groups.map(({ layer, reports }, index) => {
    const titleId = index === 0 ? "starter-title" : `starter-title-${layer}`;
    const definitionId = layer === "estimate" ? "overview-estimate-definition" : "overview-variant-call-definition";
    return (
      <section key={layer} aria-labelledby={titleId} data-starter-layer={layer}
        data-density-top-level-section className="max-w-prose">
        <p id={titleId} className="text-lg font-semibold">
          <Count value={reports.length} layerClass={layer === "estimate" ? "estimate" : "variant-call"}
            wording="starter" describedBy={definitionId} />
        </p>
        <a href={`#${definitionId}`} className="text-sm text-ink-muted underline underline-offset-2">
          {LAYER_LABELS[layer]}
        </a>
        <ol className="mt-4 space-y-1">
          {reports.map((template) => (
            <li key={template.slug}>
              <Link href={route("genome.report", { subject: "me", slug: template.slug })}
                className="inline-flex min-h-11 items-center text-base text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest">
                {template.title}
              </Link>
            </li>
          ))}
        </ol>
      </section>
    );
  });
}
