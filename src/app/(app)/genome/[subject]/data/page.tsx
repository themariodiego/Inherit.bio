import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Genome data" };

export default async function GenomeDataPage(
  props: PageProps<"/genome/[subject]/data">,
) {
  const { subject: segment } = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const subject = await resolveSubjectForAccount(user.id, segment);
  if (!subject) notFound();
  const base = `/genome/${subject.routeSegment}`;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Data</p>
        <h1 className="display text-3xl">{subject.displayLabel}&apos;s genome data</h1>
        <p className="text-base leading-relaxed text-ink-muted">
          Browse observed variants or manage the source files and their processing state.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href={`${base}/data/browser`}>Browse observed variants</Link>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-20">
          <Link href="/files">Manage source files</Link>
        </Button>
      </div>
    </div>
  );
}
