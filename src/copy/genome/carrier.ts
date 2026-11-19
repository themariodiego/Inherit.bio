/**
 * `/genome/[subject]/carrier` — one person's own carrier status over the
 * reviewed assertion rule (owner decision of 22 October 2026, "Carrier
 * status and carrier-pair arithmetic (G7.4)", `docs/protocol/decisions.md`).
 * Every user-visible string of that page is here or re-exported from its one
 * approved home.
 *
 * Almost all of it is reused, because the carrier wording is already
 * approved and this page may not invent more:
 *   - the unavailable sentence, which production shows, and the "What this
 *     check cannot tell you" list from the Family carrier panel
 *     (`src/copy/family/health-picture.ts`, owner decision of 27 September);
 *   - the variant line, the laboratory line, the penetrance label and the
 *     source line from `src/copy/family/carrier-evidence.ts` (brief §4,
 *     lines 1329-1335);
 *   - "This is not a negative result." and the not-read reason from the
 *     reviewed-library coverage copy (`src/copy/embryos/carrier-library.ts`);
 *   - the no-file sentence and the two closing lines from the report copy.
 *
 * The four new strings are plain result-structure text: the h1, the
 * preparing sentence, and the choice-is-off sentence with its link, each
 * modelled on the existing My Genome sentence for the same state
 * (`src/copy/genome/preparation.ts`, `src/copy/ancestry.ts`). None of them
 * interprets a result, gives advice or speaks about a pregnancy.
 *
 * Export names carry the readability role (scripts/readability-gate.ts):
 * `*_H1` as a heading, `*_LINK` as a label, `*_STATUS` as a status. The word
 * for a person who carries a change is jargon (data/jargon.json) and may not
 * head a page, so the h1 says what the page holds in plain words, as the
 * Family panel's "A change you both carry" does.
 */
import { CARRIER_LIMITS, CARRIER_LIMITS_HEADING, NO_CLASSIFIED_POSITIONS, carrierPersonPrefix } from "@/copy/family/health-picture";
import { CARRIER_LIBRARY_NOT_NEGATIVE, CARRIER_LIBRARY_REASONS } from "@/copy/embryos/carrier-library";
import { NO_FILE_YET, NOT_DIAGNOSTIC, PROVENANCE_LINE } from "@/copy/reports/strings";
import { OWN_REPORT_CHOICES } from "@/lib/uploads/own-report-purpose";

/** The h1, the last breadcrumb and the document title. */
export const CARRIER_STATUS_H1 = "A change you carry";

/** A file is in flight and nothing prepared can be read yet; the same shape as the other My Genome pages. */
export const CARRIER_STATUS_PREPARING_STATUS =
  "A file is still being prepared. This check says what it covers once it is ready.";

/**
 * A prepared file exists and its "Observed genetic variants" choice is off,
 * so no file may be read for this page. Worded as `ANCESTRY_OFF` is, and
 * named by the choice's own label so the two pages cannot drift apart.
 */
export const CARRIER_STATUS_OFF_STATUS =
  `The ${OWN_REPORT_CHOICES["reports.monogenic"].label} choice is off. You can turn it on under Reports, in Choose your reports.`;

/** The link beside the choice-is-off sentence, to the subject's Reports page; the words the My Genome tile uses. */
export const CARRIER_STATUS_REPORTS_LINK = "Open Reports";

/** The person the reading is about, before the copies figure: "You:". */
export const CARRIER_STATUS_READER = carrierPersonPrefix("You");

/** The name the variant line uses for the reader. */
export const CARRIER_STATUS_READER_NAME = "You";

/**
 * The Family panel's limits that are true of one person's own check. The
 * second of the five is about a change two people share, so it is not
 * repeated here; the others are reused word for word.
 */
export const OWN_CARRIER_LIMITS: readonly string[] = CARRIER_LIMITS.filter((limit) => !limit.includes("shared change"));

export {
  CARRIER_LIBRARY_NOT_NEGATIVE,
  CARRIER_LIBRARY_REASONS,
  CARRIER_LIMITS_HEADING,
  NO_CLASSIFIED_POSITIONS,
  NO_FILE_YET,
  NOT_DIAGNOSTIC,
  PROVENANCE_LINE,
};
