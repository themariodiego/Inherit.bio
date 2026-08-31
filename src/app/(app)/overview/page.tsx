import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

const domains = [
  {
    href: "/genome/me",
    eyebrow: "My Genome",
    title: "Explore what your data supports",
    description:
      "Open reports, ancestry, and the genome browser for your own subject record. Missing coverage stays missing; Inherit never guesses.",
    action: "Open My Genome",
  },
  {
    href: "/family",
    eyebrow: "Family",
    title: "Understand shared inheritance",
    description:
      "Invite adults, manage permissions, and explore family-level patterns only when every required consent is current.",
    action: "Open Family",
  },
  {
    href: "/embryos",
    eyebrow: "Embryo Analysis",
    title: "Review bounded embryo data",
    description:
      "Use supported clinical-source data with strict parentage, consent, evidence, and no-ranking safeguards.",
    action: "Open Embryo Analysis",
  },
] as const;

export default async function OverviewPage() {
  const supabase = await createClient();
  const { data: files } = await supabase
    .from("genome_files")
    .select("id, status")
    .order("created_at", { ascending: false });
  const ready = (files ?? []).filter((file) => file.status === "annotated").length;
  const processing = (files ?? []).filter((file) =>
    file.status === "uploading" || file.status === "parsing",
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <header className="space-y-3">
        <p className="eyebrow">Overview</p>
        <h1 className="display max-w-3xl text-4xl">
          Three ways to understand inheritance.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
          Choose a domain first. Results and estimates stay inside their
          relevant subject context; this page shows navigation and operational
          state only.
        </p>
      </header>

      <section aria-label="Inheritance domains" className="grid gap-5 lg:grid-cols-3">
        {domains.map((domain) => (
          <article
            key={domain.href}
            className="flex min-h-72 flex-col rounded-2xl border border-line bg-card p-6"
          >
            <p className="eyebrow">{domain.eyebrow}</p>
            <h2 className="display mt-4 text-2xl">{domain.title}</h2>
            <p className="mt-3 flex-1 text-base leading-relaxed text-ink-muted">
              {domain.description}
            </p>
            <Button asChild className="mt-6 w-full" variant="outline">
              <Link href={domain.href}>{domain.action}</Link>
            </Button>
          </article>
        ))}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-card p-5">
        <div>
          <h2 className="font-medium">Data files</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {ready} ready{processing > 0 ? ` · ${processing} processing` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/files">Manage files</Link>
          </Button>
          <Button asChild>
            <Link href="/files/upload">Add a file</Link>
          </Button>
        </div>
      </section>

      <p className="text-xs leading-relaxed text-ink-muted">
        Inherit is informational, not a medical test, and cannot tell you what
        will happen. Your genome-derived data leaves this deployment only under
        an explicit, named, revocable consent.
      </p>
    </div>
  );
}
