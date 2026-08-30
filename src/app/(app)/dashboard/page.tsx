import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  getGenotypesByRsid,
  getProcessedFiles,
  getPublishedTemplates,
  templateRsids,
} from "@/lib/genome/load";
import { resolveTemplate } from "@/lib/genome/reports";
import { createClient } from "@/lib/supabase/server";
import { isFixtureSlug } from "@/components/reports/library";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const [files, allTemplates] = await Promise.all([
    getProcessedFiles(supabase),
    getPublishedTemplates(supabase),
  ]);
  // Test fixtures never count toward user-facing library numbers.
  const templates = allTemplates.filter((t) => !isFixtureSlug(t.slug));
  const active = files[0] ?? null;

  const genotypes = active
    ? await getGenotypesByRsid(supabase, active.id, templateRsids(templates))
    : new Map<number, string>();
  const covered = active
    ? templates.filter((t) =>
        resolveTemplate(t, (r) => genotypes.get(r)).covered,
      ).length
    : 0;

  const { data: prs } = active
    ? await supabase
        .from("user_prs")
        .select("pgs_id, percentile, coverage")
        .eq("file_id", active.id)
    : { data: [] };
  const { data: ancestry } = active
    ? await supabase
        .from("ancestry_results")
        .select("kind, result")
        .eq("file_id", active.id)
    : { data: [] };

  const mtHaplo = (
    ancestry?.find((a) => a.kind === "mtdna")?.result as {
      haplogroup?: string | null;
    } | null
  )?.haplogroup;

  const cards = [
    {
      href: "/reports",
      label: "Reports covered",
      value: active ? `${covered} / ${templates.length}` : "—",
      note: active
        ? "a result is computed only when you open a report"
        : "upload a file to unlock",
    },
    {
      href: "/reports#polygenic-scores",
      label: "Polygenic scores",
      value: active ? String((prs ?? []).length) : "—",
      note: "many small genetic effects combined into one estimate",
    },
    {
      href: "/ancestry",
      label: "mtDNA haplogroup",
      value: mtHaplo ?? "—",
      note: "your mother's-side deep ancestry line",
    },
    {
      href: "/uploads",
      label: "Files",
      value: String(files.length),
      note: "raw data files processed",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Overview</p>
          <h1 className="display text-3xl">
            Your genome, <span className="accent">at a glance.</span>
          </h1>
          {active ? (
            <p className="mt-2 text-sm text-ink-muted">
              Active file: {active.original_name} (
              {active.variant_count?.toLocaleString()} variants)
            </p>
          ) : null}
        </div>
        <Button asChild>
          <Link href="/uploads">Upload data</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-2xl border border-line bg-card p-5 transition-colors hover:border-forest"
          >
            <p className="eyebrow">{c.label}</p>
            <p className="display mt-2 truncate text-3xl">{c.value}</p>
            <p className="mt-1 text-xs text-ink-muted">{c.note}</p>
          </Link>
        ))}
      </div>

      {!active ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <h2 className="display text-2xl">Start with your raw data</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            Upload a 23andMe/AncestryDNA/MyHeritage/FamilyTreeDNA export or a
            VCF. Don&apos;t have one yet? Find a sequencing provider first —
            we&apos;ll route you to them directly.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button asChild>
              <Link href="/uploads">Upload a file</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/providers">Find a provider</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-medium">Ask your genome</h2>
            <p className="mt-1 text-sm text-ink-muted">
              The copilot answers from your own reports and variants, with
              citations — locally if you prefer.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/chat">Open copilot</Link>
            </Button>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-medium">Explore variants</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Search by rsID, gene, or position; view your variants in the
              embedded genome browser.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/browse">Browse genome</Link>
            </Button>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-medium">Trace your ancestry</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Your mother&apos;s-side and father&apos;s-side deep ancestry
              lines (mtDNA and Y haplogroups), plus a continental estimate.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href="/ancestry">View ancestry</Link>
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Informational, not medical advice. Your data never leaves this
        deployment except at your explicit, revocable instruction.
      </p>
    </div>
  );
}
