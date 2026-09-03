import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { Button } from "@/components/ui/button";
import { NAV_LABELS } from "@/copy/navigation";
import { ADD_A_FILE, NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { getSubjectProcessedFiles } from "@/lib/genome/load";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const DOMAIN_LABEL = NAV_LABELS["my-genome"];

const loadSubject = cache(async (segment: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return resolveSubjectForAccount(user.id, segment);
});

export async function generateMetadata(
  props: PageProps<"/genome/[subject]">,
): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const subject = await loadSubject(segment);
  return { title: subject ? `${subject.displayLabel} · ${DOMAIN_LABEL}` : DOMAIN_LABEL };
}

export default async function GenomePage(
  props: PageProps<"/genome/[subject]">,
) {
  const { subject: segment } = await props.params;
  const subject = await loadSubject(segment);
  if (!subject) notFound();
  const files = await getSubjectProcessedFiles(createAdminClient(), subject.id);
  const base = `/genome/${subject.routeSegment}`;

  const tiles = [
    { href: `${base}/reports`, title: "Reports", copy: "Each report says what your file shows and what it cannot tell you." },
    { href: `${base}/ancestry`, title: "Ancestry", copy: "What your file supports about broad regions and parent lines." },
    { href: `/copilot/${subject.routeSegment}`, title: "Copilot", copy: "Ask questions about your own reports in plain language." },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs items={[{ label: DOMAIN_LABEL, href: base }, { label: subject.displayLabel }]} />
      <SubjectBar subject={subject} fileCount={files.length} />
      <h1 className="display text-3xl">{DOMAIN_LABEL}</h1>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Genome tools">
        {tiles.map((tile) => (
          <article key={tile.href} className="flex flex-col rounded-2xl border border-line bg-card p-5">
            <h2 className="display text-2xl">{tile.title}</h2>
            <p className="mt-2 flex-1 text-base leading-relaxed text-ink-muted">{tile.copy}</p>
            <Button asChild variant="outline" className="mt-5">
              <Link href={tile.href}>Open {tile.title}</Link>
            </Button>
          </article>
        ))}
      </section>
      <Button asChild>
        <Link href={`/files/upload?subject=${encodeURIComponent(subject.routeSegment)}`}>{ADD_A_FILE}</Link>
      </Button>
      <p className="max-w-prose text-sm text-ink-muted">{NOT_DIAGNOSTIC}</p>
    </div>
  );
}
