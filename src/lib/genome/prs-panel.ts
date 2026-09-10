/**
 * The reference-panel facts a polygenic score names on its surface (brief
 * §4 §7.6, G4.4), held in one place the way `src/lib/ancestry/panel.ts` holds
 * `PANEL` and `LINEAGE_TREES` for the ancestry surface. The copy in
 * `src/copy/genome/polygenic.ts` takes these as arguments and never retypes
 * them.
 *
 * The one difference from the ancestry panel is the version, and it is a fact
 * about the stored record rather than a gap here. A score's identity, name and
 * required position count come from a `public.prs_scores` row, and that table
 * has no version column: it holds `pgs_id`, `name`, `trait`, `n_variants`,
 * `citation`, `source_url`, `ancestry_note`, `percentile_ref` and `updated_at`
 * (`supabase/migrations/20260828000001_core.sql`, `src/lib/supabase/types.ts`).
 * The three shipped seeds in `data/prs/*.json` carry none either — `PrsScore`
 * in `src/lib/genome/prs.ts` has no such field — which `prs-panel.test.ts`
 * asserts against the shipped files rather than assuming.
 *
 * So `version` is null for every score today and the surface says so in words.
 * It is never filled from `updated_at`, which records when the catalogue row
 * was written, not which build of the score it holds, and never from the
 * `GRCh38` in `source_url`, which is a genome build rather than a panel
 * version. A made-up version would be worse than the missing one.
 */

/** One polygenic panel, as a G4.4 line names it. */
export interface ScorePanelFacts {
  /** The score's catalogue id, e.g. `PGS000011`. */
  id: string;
  /** The score's published name, e.g. `GRS50`. */
  name: string;
  /** The build of the score, or null when the record carries no version. */
  version: string | null;
}

/**
 * The panel facts of one stored score. `version` is passed through when a
 * record ever carries one, and is null — never invented — when it does not.
 */
export function scorePanel(row: {
  pgs_id: string;
  name: string;
  version?: string | null;
}): ScorePanelFacts {
  return { id: row.pgs_id, name: row.name, version: row.version ?? null };
}
