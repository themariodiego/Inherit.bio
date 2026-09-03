/**
 * The copy ids `docs/route-register.json#policyContracts.embryo-autosomal-only-v1`
 * names, resolved to their one string each. A renderer that receives a copy
 * id looks it up here; nothing else spells these strings.
 */
import {
  CELL_WORDS,
  STANDING_STATEMENT,
  WITHIN_FAMILY_NOT_TESTED,
  contextAnalysed,
  contextNotMeasurable,
  contextPassed,
  insufficientCoverage,
} from "./compare";
import {
  DROPOUT_NOT_MEASURED,
  NOT_MEASURABLE_FROM_FILE,
  NOT_STATED_BY_SOURCE,
  QC_FAILED_CHIP,
} from "./qc";
import { TRADEOFFS_EXISTS, TRADEOFFS_NONE_MEASURABLE, conflictLine } from "./tradeoffs";

export const COPY_IDS = {
  "embryo.standing-statement": STANDING_STATEMENT,
  "embryo.tradeoffs.exists": TRADEOFFS_EXISTS,
  "embryo.tradeoffs.none-measurable": TRADEOFFS_NONE_MEASURABLE,
  "embryo.tradeoffs.conflict": conflictLine,
  "embryo.qc.quality-check-not-passed": QC_FAILED_CHIP,
  "embryo.qc.not-measurable-from-file": NOT_MEASURABLE_FROM_FILE,
  "embryo.qc.source-not-stated": NOT_STATED_BY_SOURCE,
  "embryo.qc.dropout-not-measured": DROPOUT_NOT_MEASURED,
  "embryo.qc.review-required": CELL_WORDS.underReview,
  "embryo.context.analysed": contextAnalysed,
  "embryo.context.quality-check-passed": contextPassed,
  "embryo.context.not-measurable": contextNotMeasurable,
  "embryo.result.insufficient-coverage": insufficientCoverage,
  "embryo.within-family.not-tested": WITHIN_FAMILY_NOT_TESTED,
} as const;

export type CopyId = keyof typeof COPY_IDS;
