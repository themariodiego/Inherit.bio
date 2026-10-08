import type { Metadata } from "next";
import { EmptyState } from "@/components/site/empty-state";
import { REPORTS_RELABELLED } from "@/copy/reports/strings";
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
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Research library</p>
        <h1 className="display display-lg">
          New reports, <span className="accent">continuously.</span>
        </h1>
        <p className="lede reading-intro">
          Inherit checks GWAS Catalog, PGS Catalog, and ClinVar on a schedule. New
          report drafts go to people for review before they are published here.
          You can turn on email updates in Settings.
        </p>
      </header>
      <ol className="mt-section max-w-3xl space-y-block border-l border-line pl-8">
        {items.map((item) =>
          item.type === "entry" ? (
            <li key={item.entry.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[2.3rem] top-1 size-2.5 rounded-full bg-forest"
              />
              <time
                dateTime={item.entry.published_at}
                className="eyebrow"
              >
                {formatDate(item.entry.published_at)}
              </time>
              <h2 className="title mt-2">{item.entry.title}</h2>
              <p className="mt-2 max-w-measure text-ink-muted">{item.entry.body}</p>
            </li>
          ) : (
            <li key={`relabel-${item.day}`} className="relative">
              <span
                aria-hidden
                className="absolute -left-[2.3rem] top-1 size-2.5 rounded-full bg-forest"
              />
              <time dateTime={item.at} className="eyebrow">
                {formatDate(item.at)}
              </time>
              <details className="mt-2">
                <summary className="title">
                  {REPORTS_RELABELLED}
                </summary>
                <ul className="mt-2 max-w-measure space-y-2 text-sm text-ink-muted">
                  {item.entries.map((entry) => (
                    <li key={entry.id}>
                      {entry.title}{" "}
                      <span className="mono text-xs">
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
          <li>
            <EmptyState>
              No published entries yet — the pipeline is young. Check back soon.
            </EmptyState>
          </li>
        ) : null}
      </ol>
    </div>
  );
}
