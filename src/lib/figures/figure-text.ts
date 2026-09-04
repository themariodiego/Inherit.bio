/**
 * The words each figure kind renders. Kept out of the component so the
 * wording is unit-testable without React and so <Figure> is only markup.
 */
import { ANCESTRY_RANGE_UNAVAILABLE, NATURAL_FREQUENCY_FLOOR } from "./contract";
import {
  PERCENTAGE_POINTS_GLOSS,
  chooseDenominator,
  differencePercentagePoints,
  formatPercent,
  groupNumber,
  intervalSentence,
  naturalFrequency,
  percentOneDecimal,
  percentileSentence,
  renderNaturalFrequencyPair,
} from "./natural-frequency";
import { frequencyValues, type StandaloneFigureSpec } from "./spec";

export interface FigureText {
  /** The quantity itself. */
  value: string;
  /** Adjacent unit / denominator / range text, when the kind has one. */
  unit: string | null;
}

/**
 * `denominator` is the block's shared denominator: a number, null when the
 * block hit the floor, or undefined when the figure stands alone and may
 * choose its own.
 */
export function figureText(spec: StandaloneFigureSpec, denominator?: number | null): FigureText {
  switch (spec.kind) {
    case "absolute": {
      const d = denominator === undefined ? chooseDenominator([spec.value]) : denominator;
      return {
        value: formatPercent(spec.value),
        unit: d === null ? NATURAL_FREQUENCY_FLOOR : `${naturalFrequency(spec.value, d).text} ${spec.group}`,
      };
    }
    case "natural-frequency": {
      const d = denominator === undefined ? chooseDenominator(frequencyValues(spec)) : denominator;
      if ("value" in spec) {
        return { value: d === null ? NATURAL_FREQUENCY_FLOOR : naturalFrequency(spec.value, d).text, unit: null };
      }
      return {
        value: renderNaturalFrequencyPair(
          spec.subject,
          spec.comparator,
          spec.subjectGroup,
          spec.comparatorGroup,
          d,
        ),
        unit: null,
      };
    }
    case "percentile":
      return { value: percentileSentence(spec.value), unit: null };
    case "coverage":
      return {
        value: `read ${groupNumber(spec.read)} of the ${groupNumber(spec.needed)} positions this needs`,
        unit: null,
      };
    case "interval":
      return { value: intervalSentence(spec.point, spec.low, spec.high), unit: null };
    case "genotype":
      return { value: spec.genotype, unit: null };
    case "carrier-status":
      return { value: spec.status, unit: null };
    case "ancestry-share":
      // One decimal always (§4.6 display rounding), and the range or the
      // explicit statement that there is none yet (G4.4).
      return {
        value: `${percentOneDecimal(spec.share)}%`,
        unit:
          "unavailable" in spec.range
            ? ANCESTRY_RANGE_UNAVAILABLE
            : `(${percentOneDecimal(spec.range.low)}–${percentOneDecimal(spec.range.high)}%)`,
      };
    case "difference-pp":
      return {
        value: differencePercentagePoints(spec.after, spec.before).text,
        unit: PERCENTAGE_POINTS_GLOSS,
      };
    case "measure":
      return { value: spec.value.toFixed(spec.decimals), unit: spec.unit };
  }
}
