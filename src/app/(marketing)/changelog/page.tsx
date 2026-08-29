import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Research changelog",
  description:
    "Every report added to the Inherit library, with dates — the output of our continuously running research pipeline.",
};

export default async function ChangelogPage() {
  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("changelog_entries")
    .select("id, title, body, template_slug, published_at")
    .order("published_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow mb-4">Research library</p>
      <h1 className="display text-4xl">
        New reports, <span className="accent">continuously.</span>
      </h1>
      <p className="mt-4 max-w-xl text-ink-muted">
        A scheduled pipeline watches GWAS Catalog, PGS Catalog, and ClinVar
        releases, drafts candidate reports into a human review queue, and
        publishes here. Opt into the email digest in Settings.
      </p>
      <ol className="mt-10 space-y-8 border-l border-line pl-6">
        {(entries ?? []).map((e) => (
          <li key={e.id} className="relative">
            <span
              aria-hidden
              className="absolute -left-[1.85rem] top-1.5 size-2.5 rounded-full bg-forest"
            />
            <time
              dateTime={e.published_at}
              className="eyebrow"
            >
              {new Date(e.published_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
            <h2 className="mt-1 font-medium">{e.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{e.body}</p>
          </li>
        ))}
        {(entries ?? []).length === 0 ? (
          <li className="text-sm text-ink-muted">
            No published entries yet — the pipeline is young. Check back soon.
          </li>
        ) : null}
      </ol>
    </div>
  );
}
