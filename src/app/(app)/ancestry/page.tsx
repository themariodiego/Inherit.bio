import type { Metadata } from "next";
import { getActiveFile } from "@/lib/genome/load";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ancestry" };

const POP_LABELS: Record<string, string> = {
  AFR: "African",
  AMR: "Admixed American",
  EAS: "East Asian",
  EUR: "European",
  SAS: "South Asian",
};

interface AdmixtureResult {
  proportions: Record<string, number>;
  markersUsed: number;
  note: string;
}

interface HaploResult {
  haplogroup: string | null;
  path?: string[];
  matched?: number;
  tested?: number;
  support?: string;
  note?: string;
}

export default async function AncestryPage(props: PageProps<"/ancestry">) {
  const searchParams = await props.searchParams;
  const fileParam =
    typeof searchParams.file === "string" ? searchParams.file : undefined;

  const supabase = await createClient();
  const active = await getActiveFile(supabase, fileParam);
  const { data: results } = active
    ? await supabase
        .from("ancestry_results")
        .select("kind, result, support_note")
        .eq("file_id", active.id)
    : { data: [] };

  const admix = results?.find((r) => r.kind === "admixture");
  const mt = results?.find((r) => r.kind === "mtdna");
  const y = results?.find((r) => r.kind === "ydna");

  const admixData = admix?.result as unknown as AdmixtureResult | undefined;
  const mtData = mt?.result as unknown as HaploResult | undefined;
  const yData = y?.result as unknown as HaploResult | undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="eyebrow mb-2">Ancestry</p>
        <h1 className="display text-3xl">What your file supports</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Ancestry estimates depend on which positions your file covers. Every
          panel below says exactly what it could and couldn&apos;t measure —
          continental estimates from ~180 informative markers are coarse by
          design, not a percentage of your identity.
        </p>
      </div>

      {!active ? (
        <p className="rounded-xl border border-line bg-card p-6 text-sm text-ink-muted">
          Process a raw data file to see ancestry estimates.
        </p>
      ) : null}

      {admixData ? (
        <section
          data-testid="admixture"
          className="rounded-2xl border border-line bg-card p-5"
        >
          <h2 className="font-medium">Continental admixture estimate</h2>
          <div className="mt-4 space-y-2">
            {Object.entries(admixData.proportions)
              .sort(([, a], [, b]) => b - a)
              .map(([pop, frac]) => (
                <div key={pop} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0">
                    {POP_LABELS[pop] ?? pop}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-tint">
                    <div
                      className="h-full rounded-full bg-forest"
                      style={{ width: `${Math.round(frac * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-xs">
                    {(frac * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
          </div>
          <p className="mt-4 text-xs text-ink-muted">{admix?.support_note}</p>
        </section>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <section
          data-testid="mtdna"
          className="rounded-2xl border border-line bg-card p-5"
        >
          <h2 className="font-medium">mtDNA haplogroup (maternal line)</h2>
          {mtData?.haplogroup ? (
            <>
              <p className="display mt-3 text-4xl text-forest">
                {mtData.haplogroup}
              </p>
              {mtData.path ? (
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  {mtData.path.join(" → ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">Not determined.</p>
          )}
          <p className="mt-3 text-xs text-ink-muted">{mt?.support_note}</p>
        </section>

        <section
          data-testid="ydna"
          className="rounded-2xl border border-line bg-card p-5"
        >
          <h2 className="font-medium">Y haplogroup (paternal line)</h2>
          {yData?.haplogroup ? (
            <>
              <p className="display mt-3 text-4xl text-forest">
                {yData.haplogroup}
              </p>
              {yData.path ? (
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  {yData.path.join(" → ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">Not determined.</p>
          )}
          <p className="mt-3 text-xs text-ink-muted">{y?.support_note}</p>
        </section>
      </div>

      <p className="rounded-xl border border-line p-4 text-xs leading-relaxed text-ink-muted">
        These are statistical estimates against public reference panels (1000
        Genomes phase 3), informational only. Haplogroup calls state how many
        defining markers your file actually covered; array files cover far
        fewer than whole-genome data.
      </p>
    </div>
  );
}
