/**
 * The seven synthetic classified positions of `carrier-pair-grch38.vcf`, in
 * one place so the generator that writes the fixture and the spec that
 * classifies the positions can never drift apart.
 *
 * These rsIDs are reserved synthetic values that exist in no public
 * catalogue, and the coordinates are written here rather than read from
 * anywhere: the fixture describes no real person.
 *
 * `gt` is the VCF genotype the fixture writes at each position, against
 * `REF` A and `ALT` G (a second ALT, T, is written where the row needs a
 * changed letter that is not the classified one):
 *   - `0/1`: one changed copy and one unchanged, the carrier reading;
 *   - `1/1`: two changed copies, which the closed table names `two-copies`;
 *   - `0/2`: a changed copy of the other letter (A/T), so the file covers
 *     the position but shows no copy of the classified change, and the
 *     position counts toward "both files cover" without ever being a match.
 */

export type FixtureGenotype = "0/1" | "1/1" | "0/2";

export interface CarrierFixturePosition {
  rsid: number;
  /** The coordinate on chromosome 1, spaced so no other fixture row collides. */
  pos: number;
  gt: FixtureGenotype;
}

export const CARRIER_FIXTURE_POSITIONS: readonly CarrierFixturePosition[] = [
  { rsid: 999_999_001, pos: 21_000_000, gt: "0/1" },
  { rsid: 999_999_002, pos: 41_000_000, gt: "0/1" },
  { rsid: 999_999_003, pos: 61_000_000, gt: "0/1" },
  { rsid: 999_999_004, pos: 81_000_000, gt: "0/1" },
  { rsid: 999_999_005, pos: 101_000_000, gt: "1/1" },
  { rsid: 999_999_006, pos: 121_000_000, gt: "0/2" },
  { rsid: 999_999_007, pos: 141_000_000, gt: "0/2" },
] as const;

export const CARRIER_RSIDS = CARRIER_FIXTURE_POSITIONS.map((entry) => entry.rsid);

export const CARRIER_POSITIONS = CARRIER_FIXTURE_POSITIONS.map((entry) => entry.pos);

/** The unchanged and the changed letter at each of the seven. */
export const CARRIER_REF = "A";
export const CARRIER_ALT = "G";

/** The other changed letter, written only where a row needs a change that is not the classified one. */
export const CARRIER_OTHER_ALT = "T";

/** The genotype the parser reads for each fixture genotype, letters sorted as the parser sorts them. */
export function parsedGenotype(gt: FixtureGenotype): string {
  const letters =
    gt === "0/1"
      ? [CARRIER_REF, CARRIER_ALT]
      : gt === "1/1"
        ? [CARRIER_ALT, CARRIER_ALT]
        : [CARRIER_REF, CARRIER_OTHER_ALT];
  return [...letters].sort().join("/");
}
