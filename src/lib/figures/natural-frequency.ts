/**
 * Pure number-to-words helpers for the figure contract. Every value passed
 * in is a probability in [0, 1] unless the name says otherwise; every string
 * out uses en-GB grouping (`1,000`).
 */
import {
  NATURAL_FREQUENCY_DENOMINATORS,
  NATURAL_FREQUENCY_FLOOR,
  REFERENCE_GROUP_SHORT,
} from "./contract";

const grouped = new Intl.NumberFormat("en-GB");
const twoSignificant = new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 2 });
const oneDecimal = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function groupNumber(value: number): string {
  return grouped.format(value);
}

/** Two values are "the same" at denominator D when they differ by less than half a count. */
function sameAtDisplayPrecision(a: number, b: number, denominator: number): boolean {
  return Math.abs(a - b) < 0.5 / denominator;
}

/**
 * The smallest denominator on the ladder at which every value rounds to a
 * count ≥ 1 and any two values that differ by at least display precision
 * (0.5/D) round to different counts. Returns null when no denominator works;
 * the caller then renders NATURAL_FREQUENCY_FLOOR.
 */
export function chooseDenominator(values: number[]): number | null {
  if (values.length === 0) throw new Error("chooseDenominator needs at least one value");
  for (const denominator of NATURAL_FREQUENCY_DENOMINATORS) {
    const counts = values.map((value) => Math.round(value * denominator));
    if (counts.some((count) => count < 1)) continue;
    let distinct = true;
    for (let i = 0; i < values.length && distinct; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (counts[i] === counts[j] && !sameAtDisplayPrecision(values[i], values[j], denominator)) {
          distinct = false;
          break;
        }
      }
    }
    if (distinct) return denominator;
  }
  return null;
}

export function naturalFrequency(
  value: number,
  denominator: number,
): { count: number; denominator: number; text: string } {
  const count = Math.round(value * denominator);
  return {
    count,
    denominator,
    text: `about ${groupNumber(count)} in ${groupNumber(denominator)}`,
  };
}

/**
 * Both figures on one shared denominator, or the floor string. The optional
 * fifth argument lets a claim block impose its single block denominator.
 */
export function renderNaturalFrequencyPair(
  subject: number,
  comparator: number,
  subjectGroup: string,
  comparatorGroup: string,
  denominator: number | null = chooseDenominator([subject, comparator]),
): string {
  if (denominator === null) return NATURAL_FREQUENCY_FLOOR;
  const s = naturalFrequency(subject, denominator);
  const c = naturalFrequency(comparator, denominator);
  const d = groupNumber(denominator);
  return `About ${groupNumber(s.count)} in ${d} ${subjectGroup}. About ${groupNumber(c.count)} in ${d} ${comparatorGroup}.`;
}

/** The percent numeral without its sign: below 1% two significant figures, 1–9.9% one decimal, ≥10% whole. */
export function percentNumeral(value: number): string {
  const percent = value * 100;
  if (percent < 1) return twoSignificant.format(percent);
  if (percent < 10) {
    const text = oneDecimal.format(percent);
    return text === "10.0" ? whole.format(percent) : text;
  }
  return whole.format(percent);
}

export function formatPercent(value: number): string {
  return `${percentNumeral(value)}%`;
}

/** The percent numeral to one decimal always (ancestry shares, brief §4.6): 0.432 → "43.2". */
export function percentOneDecimal(value: number): string {
  return oneDecimal.format(value * 100);
}

/** Percentiles are integers clamped 1–99 and always a sentence; a bare "80th percentile" is banned. */
export function percentileSentence(percentile: number): string {
  const clamped = Math.min(99, Math.max(1, Math.round(percentile)));
  return `higher than about ${clamped} of every 100 ${REFERENCE_GROUP_SHORT}`;
}

export function pointSentence(point: number): string {
  return `Your estimated risk is ${formatPercent(point)}.`;
}

/**
 * §2.6 wording. The point is taken so the rendered range always brackets it:
 * a range that excludes its own point estimate is never shown.
 */
export function intervalSentence(point: number, low: number, high: number): string {
  const lo = Math.min(low, point);
  const hi = Math.max(high, point);
  return `It could reasonably be ${formatPercent(lo)} to ${formatPercent(hi)}.`;
}

export const PERCENTAGE_POINTS_GLOSS = "(percentage points, not percent)";

/**
 * `a` and `b` are probabilities; the difference is reported in percentage
 * points to one decimal. A zero difference reads "0.0 percentage points higher".
 */
export function differencePercentagePoints(a: number, b: number): { points: number; text: string } {
  const points = (a - b) * 100;
  const direction = points >= 0 ? "higher" : "lower";
  return { points, text: `${oneDecimal.format(Math.abs(points))} percentage points ${direction}` };
}
