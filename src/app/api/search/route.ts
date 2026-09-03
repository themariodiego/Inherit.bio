import { NextResponse, type NextRequest } from "next/server";
import { isFixtureSlug } from "@/components/reports/library";
import { subjectKind } from "@/components/subjects/subject-bar";
import { KIND_CHIPS } from "@/copy/reports/strings";
import { SEARCH_GROUP_LABELS, SETTINGS_SEARCH_PAGES } from "@/copy/search";
import { getPublishedTemplates } from "@/lib/genome/load";
import type { ReportTemplate } from "@/lib/genome/reports";
import { categoryFor, categoryLabel } from "@/lib/genome/taxonomy";
import { route } from "@/lib/primary-routes";
import { search, type SearchCandidate, type SearchGroup } from "@/lib/search/match";
import { listSubjectsForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/search?q= — the one global search (brief §2 §1.3; route register
 * `api.search`). Groups, in order: People and embryos, Reports, Ancestry
 * regions, Settings; at most 8 results per group, only non-empty groups.
 *
 * Search returns destinations only. Every row is a label, an href built by
 * src/lib/primary-routes.ts and, for a row that refers to subject-derived
 * data, that subject's kind chip. No genotype, percentile, risk value or
 * ancestry share is read here, let alone returned. The sensitive header
 * profile is applied by src/proxy.ts, which covers every /api/* path.
 */

/** Longer queries are cut, not rejected: nothing useful is longer than this. */
const MAX_QUERY_LENGTH = 100;

/** A template with an unmapped legacy category is left out rather than crashing the search. */
function safeCategoryLabel(template: ReportTemplate): string | null {
  try {
    return categoryLabel(categoryFor(template));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
  if (query.trim() === "") return NextResponse.json({ groups: [] as SearchGroup[] });

  const admin = createAdminClient();
  const [subjects, templates] = await Promise.all([
    listSubjectsForAccount(user.id),
    getPublishedTemplates(admin),
  ]);

  const candidates: SearchCandidate[] = [];

  // People and embryos: every subject the account can see, matched on its
  // display label, chipped relative to the viewer exactly as the subject bar
  // chips it. A record that can carry no chip (a `minor` record, D11) is not
  // listed, because a subject row without its chip is not permitted.
  for (const subject of subjects) {
    const kind = subjectKind(subject, user.id);
    if (!kind) continue;
    candidates.push({
      group: "people",
      label: subject.displayLabel,
      href: route("genome.subject", { subject: subject.routeSegment }),
      chip: KIND_CHIPS[kind],
    });
  }

  // Reports: the published, non-fixture library, matched on the title, the
  // gene symbols and the nine-category label; each row opens the report for
  // the account's own genome and so carries the "You" chip.
  for (const template of templates) {
    if (isFixtureSlug(template.slug)) continue;
    const category = safeCategoryLabel(template);
    if (category === null) continue;
    candidates.push({
      group: "reports",
      label: template.title,
      href: route("genome.report", { subject: "me", slug: template.slug }),
      chip: KIND_CHIPS.self,
      terms: [...new Set(template.variants.map((variant) => variant.gene)), category],
    });
  }

  // Ancestry regions: no region data exists today, so no candidate is added
  // and the group appears only once it has real results — never a share and
  // never a made-up region.

  // Settings: the settings pages the register lists, matched on their labels.
  for (const page of SETTINGS_SEARCH_PAGES) {
    candidates.push({ group: "settings", label: page.label, href: page.href, terms: page.terms });
  }

  return NextResponse.json({ groups: search(candidates, query, SEARCH_GROUP_LABELS) });
}
