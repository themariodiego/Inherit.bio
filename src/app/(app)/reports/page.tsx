import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, EVIDENCE_LABELS } from "@/lib/genome/categories";
import {
  getActiveFile,
  getGenotypesByRsid,
  getProcessedFiles,
  getPublishedTemplates,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage(props: PageProps<"/reports">) {
  const searchParams = await props.searchParams;
  const fileParam =
    typeof searchParams.file === "string" ? searchParams.file : undefined;

  const supabase = await createClient();
  const [files, templates] = await Promise.all([
    getProcessedFiles(supabase),
    getPublishedTemplates(supabase),
  ]);
  const active = await getActiveFile(supabase, fileParam);

  const genotypes = active
    ? await getGenotypesByRsid(supabase, active.id, templateRsids(templates))
    : new Map<number, string>();

  const resolved = templates.map((t) =>
    resolveTemplate(t, (rsid) => genotypes.get(rsid)),
  );
  const coveredCount = resolved.filter((r) => r.covered).length;

  const byCategory = new Map<string, typeof resolved>();
  for (const r of resolved) {
    const list = byCategory.get(r.template.category) ?? [];
    list.push(r);
    byCategory.set(r.template.category, list);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="eyebrow mb-2">Report library</p>
        <h1 className="display text-3xl">Reports</h1>
        {active ? (
          <p className="mt-2 text-sm text-ink-muted">
            {coveredCount} of {templates.length} reports have genotype-specific
            results for <strong>{active.original_name}</strong>
            {files.length > 1 ? (
              <>
                {" · "}
                {files
                  .filter((f) => f.id !== active.id)
                  .map((f) => (
                    <Link
                      key={f.id}
                      href={`/reports?file=${f.id}`}
                      className="underline underline-offset-2"
                    >
                      switch to {f.original_name}
                    </Link>
                  ))}
              </>
            ) : null}
            . The rest state honestly that your file doesn&apos;t cover their
            variants.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Upload and process a raw data file to see genotype-specific
            results. The full library is browsable meanwhile.
          </p>
        )}
      </div>

      {[...byCategory.entries()].map(([category, reports]) => (
        <section key={category}>
          <h2 className="eyebrow mb-3">
            {CATEGORY_LABELS[category] ?? category}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reports.map(({ template, covered }) => (
              <li key={template.slug}>
                <Link
                  href={`/reports/${template.slug}`}
                  className="block h-full rounded-xl border border-line bg-card p-4 transition-colors hover:border-forest"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium">{template.title}</h3>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {EVIDENCE_LABELS[template.evidence]}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
                    {template.summary}
                  </p>
                  <p className="mt-2 text-xs">
                    {active ? (
                      covered ? (
                        <span className="text-ok">Result available</span>
                      ) : (
                        <span className="text-ink-muted">
                          Not covered by your file
                        </span>
                      )
                    ) : (
                      <span className="text-ink-muted">Awaiting your data</span>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {templates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          The report library has not been seeded on this deployment yet.
        </p>
      ) : null}
    </div>
  );
}
