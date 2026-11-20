/**
 * The thresholds Inherit's targeted read caller applies (G7.4, ADR 0038).
 *
 * ENGINEERING DEFAULTS PENDING SCIENTIFIC REVIEW. No scientist has reviewed
 * these numbers or the rule below, and nothing in the product may present
 * them as reviewed: `reviewed` is the literal `false`, the VCF header carries
 * it, and the provenance sentence says so. They are registered as pending in
 * `docs/capability-register.md` (Sequence ingest (BAM, CRAM)) and ADR 0038.
 *
 * The rule, at one known position with one reference letter and the panel's
 * alternate letters:
 *
 * 1. A read counts only when it is mapped, primary, not a duplicate, not a
 *    quality-check failure and not supplementary, and its mapping quality is
 *    at least `minimumMappingQuality`.
 * 2. Its base at the position counts only when its base quality is at least
 *    `minimumBaseQuality`; a base with no stored quality, or an `N`, does not
 *    count. A deletion or skip across the position counts as a letter other
 *    than the panel's. The two reads of one paired fragment count once; if
 *    they disagree, neither counts.
 * 3. No read overlaps the position at all: the position is not covered and
 *    no row is written, exactly as a VCF that does not list it.
 * 4. Fewer than `minimumDepth` counted letters: no call (`./.`).
 * 5. More than `1 - homozygousMinimum` of the counted letters are neither
 *    the reference nor the strongest alternate: no call.
 * 6. Otherwise, with f = alternate / (reference + alternate):
 *    f ≤ 1 - homozygousMinimum → 0/0; f ≥ homozygousMinimum → 1/1;
 *    heterozygousLow ≤ f ≤ heterozygousHigh → 0/1; anything between the
 *    bands is no call. A no call is never turned into a genotype.
 */
export const READ_CALLING_THRESHOLDS = {
  version: "inherit-read-calls-v1",
  minimumDepth: 10,
  minimumBaseQuality: 20,
  minimumMappingQuality: 20,
  heterozygousLow: 0.25,
  heterozygousHigh: 0.75,
  homozygousMinimum: 0.9,
  reviewed: false,
} as const;

export type ReadCallingThresholds = {
  readonly version: typeof READ_CALLING_THRESHOLDS.version;
  readonly minimumDepth: number;
  readonly minimumBaseQuality: number;
  readonly minimumMappingQuality: number;
  readonly heterozygousLow: number;
  readonly heterozygousHigh: number;
  readonly homozygousMinimum: number;
  readonly reviewed: false;
};

/** SAM FLAG bits whose reads never count (rule 1). */
export const EXCLUDED_READ_FLAGS = 0x4 | 0x100 | 0x200 | 0x400 | 0x800;
