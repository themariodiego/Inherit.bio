import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Research changelog",
  description:
    "Every report added to the Inherit library, with dates — the output of our continuously running research pipeline.",
};

const COLUMNS =
  "id, title, body, template_slug, published_at, kind, evidence_before, evidence_after";

interface Entry {
  id: string;
  title: string;
  body: string;
  template_slug: string | null;
  published_at: string;
  kind: string | null;
  evidence_before: string | null;
  evidence_after: string | null;
}

// One timeline item is either an ordinary entry or one collapsed group of
// evidence re-labels published on the same day, so a bulk rubric re-mapping
// does not drown the ordinary entries.
type TimelineItem =
  | { type: "entry"; at: string; entry: Entry }
  | { type: "relabel-group"; at: string; day: string; entries: Entry[] };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ChangelogPage() {
  const supabase = await createClient();
  const [{ data: ordinary }, { data: relabels }] = await Promise.all([
    supabase
      .from("changelog_entries")
      .select(COLUMNS)
      .or("kind.is.null,kind.neq.evidence_relabel")
      .order("published_at", { ascending: false })
      .limit(100),
    supabase
      .from("changelog_entries")
      .select(COLUMNS)
      .eq("kind", "evidence_relabel")
      .order("published_at", { ascending: false })
      .order("title", { ascending: true })
      .limit(500),
  ]);

  const groups = new Map<string, Entry[]>();
  for (const entry of (relabels ?? []) as Entry[]) {
    const day = entry.published_at.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(entry);
    groups.set(day, list);
  }
  const items: TimelineItem[] = [
    ...((ordinary ?? []) as Entry[]).map(
      (entry): TimelineItem => ({ type: "entry", at: entry.published_at, entry }),
    ),
    ...[...groups.entries()].map(
      ([day, entries]): TimelineItem => ({
        type: "relabel-group",
        at: entries[0].published_at,
        day,
        entries,
      }),
    ),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow mb-4">Research library</p>
      <h1 className="display text-4xl">
        New reports, <span className="accent">continuously.</span>
      </h1>
      <p className="mt-4 max-w-xl text-ink-muted">
        Inherit checks GWAS Catalog, PGS Catalog, and ClinVar on a schedule. New
        report drafts go to people for review before they are published here.
        You can turn on email updates in Settings.
      </p>
      <ol className="mt-10 space-y-8 border-l border-line pl-6">
        {items.map((item) =>
          item.type === "entry" ? (
            <li key={item.entry.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.85rem] top-1.5 size-2.5 rounded-full bg-forest"
              />
              <time
                dateTime={item.entry.published_at}
                className="eyebrow"
              >
                {formatDate(item.entry.published_at)}
              </time>
              <h2 className="mt-1 font-medium">{item.entry.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{item.entry.body}</p>
            </li>
          ) : (
            <li key={`relabel-${item.day}`} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.85rem] top-1.5 size-2.5 rounded-full bg-forest"
              />
              <time dateTime={item.at} className="eyebrow">
                {formatDate(item.at)}
              </time>
              <details className="mt-1">
                <summary className="cursor-pointer font-medium">
                  {item.entries.length} reports re-labelled under the new evidence rubric
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-ink-muted">
                  {item.entries.map((entry) => (
                    <li key={entry.id}>
                      {entry.title}{" "}
                      <span className="font-mono text-xs">
                        {entry.evidence_before} → {entry.evidence_after}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ),
        )}
        {items.length === 0 ? (
          <li className="text-sm text-ink-muted">
            No published entries yet — the pipeline is young. Check back soon.
          </li>
        ) : null}
      </ol>
    </div>
  );
}
