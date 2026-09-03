/**
 * Global search matching (brief §2 §1.3). Pure: no I/O, no framework.
 *
 * The API route (src/app/api/search/route.ts) turns its sources into
 * candidates and calls `search`, which normalises the query, keeps the
 * candidates that match, ranks them, caps every group at MAX_RESULTS_PER_GROUP,
 * drops empty groups and returns the survivors in GROUP_ORDER — never more
 * than MAX_GROUPS. A result carries only a destination: a label, an href and
 * the subject's kind chip when the row refers to subject-derived data. There
 * is no field for a genotype, a percentile, a risk value or an ancestry share,
 * and `terms` (matched, never shown) are stripped before results leave here.
 */

/** The four groups, in the mandated order. There is no Help group. */
export const GROUP_ORDER = ["people", "reports", "ancestry", "settings"] as const;

export type SearchGroupId = (typeof GROUP_ORDER)[number];

export const MAX_RESULTS_PER_GROUP = 8;

export const MAX_GROUPS = 4;

export interface SearchCandidate {
  group: SearchGroupId;
  /** The row's visible text. */
  label: string;
  /** Built by src/lib/primary-routes.ts; never a spelled path. */
  href: string;
  /** The subject's kind chip word (src/copy/reports/strings.ts KIND_CHIPS). */
  chip?: string;
  /** Extra text the row matches on but never shows (gene symbols, a category label). */
  terms?: readonly string[];
}

export interface SearchResult {
  label: string;
  href: string;
  chip?: string;
}

export interface SearchGroup {
  id: SearchGroupId;
  label: string;
  results: SearchResult[];
}

/**
 * Lower-case, accent-free, single-spaced text: `Café  Au-Lait` → `cafe au-lait`.
 * Applied to the query and to every matched field so that `maya` finds
 * `Maya` and `cafe` finds `Café`.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a normalised query matches one normalised field, lower is better:
 * 0 the whole field, 1 the field's start, 2 the start of a later word,
 * 3 anywhere inside it. `null` when it does not match at all.
 */
export function matchRank(query: string, field: string): number | null {
  if (query === "" || field === "") return null;
  if (field === query) return 0;
  if (field.startsWith(query)) return 1;
  const index = field.indexOf(query);
  if (index < 0) return null;
  return field[index - 1] === " " ? 2 : 3;
}

/**
 * The tokens of a query that has no contiguous match may still all appear
 * somewhere in the candidate (`heart high` finds `High blood pressure —
 * heart`): that is the weakest rank.
 */
const TOKEN_RANK = 4;

/** The best rank of a candidate against a normalised query; `null` when it does not match. */
export function rankCandidate(candidate: SearchCandidate, query: string): number | null {
  const fields = [candidate.label, ...(candidate.terms ?? [])].map(normalise);
  let best: number | null = null;
  fields.forEach((field, index) => {
    const rank = matchRank(query, field);
    if (rank === null) return;
    // A label match outranks the same match on a hidden term.
    const weighted = index === 0 ? rank : rank + 0.5;
    if (best === null || weighted < best) best = weighted;
  });
  if (best !== null) return best;
  const tokens = query.split(" ");
  const haystack = fields.join(" ");
  return tokens.length > 1 && tokens.every((token) => haystack.includes(token)) ? TOKEN_RANK : null;
}

function toResult(candidate: SearchCandidate): SearchResult {
  return candidate.chip === undefined
    ? { label: candidate.label, href: candidate.href }
    : { label: candidate.label, href: candidate.href, chip: candidate.chip };
}

/**
 * Every matching candidate, ranked and capped per group, in GROUP_ORDER.
 * Ties keep the candidates' input order (subjects by creation, templates by
 * category then title, settings pages by register order). An empty or
 * whitespace query matches nothing.
 */
export function search(
  candidates: readonly SearchCandidate[],
  rawQuery: string,
  groupLabels: Readonly<Record<SearchGroupId, string>>,
): SearchGroup[] {
  const query = normalise(rawQuery);
  if (query === "") return [];

  const ranked = candidates.flatMap((candidate, index) => {
    const rank = rankCandidate(candidate, query);
    return rank === null ? [] : [{ candidate, rank, index }];
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);

  const groups: SearchGroup[] = [];
  for (const id of GROUP_ORDER) {
    const results = ranked
      .filter((entry) => entry.candidate.group === id)
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((entry) => toResult(entry.candidate));
    if (results.length > 0) groups.push({ id, label: groupLabels[id], results });
  }
  return groups.slice(0, MAX_GROUPS);
}
