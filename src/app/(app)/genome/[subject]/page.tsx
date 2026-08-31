import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getSubjectProcessedFiles } from "@/lib/genome/load";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Genome" };

export default async function GenomePage(
  props: PageProps<"/genome/[subject]">,
) {
  const { subject: segment } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const subject = await resolveSubjectForAccount(user.id, segment);
  if (!subject) notFound();
  const files = await getSubjectProcessedFiles(createAdminClient(), subject.id);
  const base = `/genome/${subject.routeSegment}`;

  const entries = [
    { href: `${base}/reports`, title: "Reports", copy: "Evidence-labelled interpretations with explicit coverage states." },
    { href: `${base}/ancestry`, title: "Ancestry", copy: "Reference-panel estimates and resolution limits supported by the files." },
    { href: `${base}/data`, title: "Data", copy: "Source files, variant exploration, and provenance." },
    { href: `/copilot/${subject.routeSegment}`, title: "Copilot", copy: "Questions grounded in this subject scope, with model and consent controls." },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">My Genome</p>
        <h1 className="display text-3xl">{subject.displayLabel}</h1>
        <p className="text-base text-ink-muted">
          {files.length} processed {files.length === 1 ? "file" : "files"} in this subject record.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Genome tools">
        {entries.map((entry) => (
          <article key={entry.href} className="flex flex-col rounded-2xl border border-line bg-card p-5">
            <h2 className="display text-2xl">{entry.title}</h2>
            <p className="mt-2 flex-1 text-base leading-relaxed text-ink-muted">{entry.copy}</p>
            <Button asChild variant="outline" className="mt-5">
              <Link href={entry.href}>Open {entry.title}</Link>
            </Button>
          </article>
        ))}
      </section>
      <Button asChild>
        <Link href="/files/upload">Add a file</Link>
      </Button>
      <p className="text-xs text-ink-muted">
        Inherit is not a medical test and cannot tell you what will happen.
      </p>
    </div>
  );
}
