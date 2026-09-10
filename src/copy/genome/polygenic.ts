/**
 * Polygenic surface copy: the per-score block on `/genome/[subject]/data`
 * (brief §4 §7.6, G4.4). Strings ship character-for-character: typographic
 * apostrophes (U+2019), sentence case, second person, grade ≤ 9.
 *
 * G4.4 asks four things of every quantity read against a reference panel — the
 * panel and its version, the informative markers used of those required, an
 * interval or an explicit statement that none is available, and the resolution
 * limit in plain words — and two more of a polygenic result, the coverage
 * fraction and the ancestry-portability statement. The markers used of those
 * required and the coverage fraction are the `coverage` figure the surface
 * already renders; the portability statement is the score's own seeded
 * `ancestry_note`. This module carries the remaining three, in the shape
 * `src/copy/ancestry.ts` established for the lineage cards: `panelVersionLine`
 * mirrors `treeLine`, `RESOLUTION_LIMIT` mirrors `LINEAGE_RESOLUTION_LIMIT`,
 * and the absent interval is the report surface's own sentence rather than a
 * second spelling of it.
 *
 * Nothing numeric is retyped here. `panelVersionLine` takes the stored panel
 * facts from `src/lib/genome/prs-panel.ts` as an argument, so no version is
 * spelled in this file and none can be invented in it.
 */
import { NO_RANGE_YET } from "@/copy/reports/strings";
import type { ScorePanelFacts } from "@/lib/genome/prs-panel";

/**
 * The panel a score was read against and its version (G4.4). No shipped record
 * carries a version, so the sentence states that plainly instead of implying a
 * build that was never recorded; a record that ever does carry one renders it.
 */
export function panelVersionLine(panel: ScorePanelFacts): string {
  if (panel.version === null) {
    return `Read against the ${panel.name} panel, ${panel.id}. No version is recorded for this panel, and Inherit will not guess one.`;
  }
  return `Read against the ${panel.name} panel, ${panel.id}, version ${panel.version}.`;
}

/**
 * The resolution limit in plain words (G4.4): the panel is a fixed list read as
 * a whole, so it separates nothing inside that list and sees nothing outside it.
 */
export const RESOLUTION_LIMIT =
  "This panel reads one fixed list of positions. It gives one total for the whole list, not a result for any single position. It cannot see changes it does not test.";

/**
 * G4.4's disjunction for a score: there is no interval, and the surface says so
 * rather than implying certainty. The same sentence the report surface and the
 * capability register already carry, re-exported rather than respelled, so the
 * two surfaces cannot drift apart.
 */
export { NO_RANGE_YET };
