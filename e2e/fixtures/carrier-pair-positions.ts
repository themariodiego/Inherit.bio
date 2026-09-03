/**
 * The four synthetic classified positions of `carrier-pair-grch38.vcf`, in
 * one place so the generator that writes the fixture and the spec that
 * classifies the positions can never drift apart.
 *
 * These rsIDs are reserved synthetic values that exist in no public
 * catalogue, and the coordinates are written here rather than read from
 * anywhere: the fixture describes no real person.
 */

export const CARRIER_RSIDS = [999_999_001, 999_999_002, 999_999_003, 999_999_004] as const;

/** Their coordinates on chromosome 1, spaced so no other fixture row collides. */
export const CARRIER_POSITIONS = [21_000_000, 41_000_000, 61_000_000, 81_000_000] as const;

/** The unchanged and the changed letter at each of the four. */
export const CARRIER_REF = "A";
export const CARRIER_ALT = "G";
