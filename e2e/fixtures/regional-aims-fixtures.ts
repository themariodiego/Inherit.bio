/** Shared synthetic cases; no generator entry point runs during test discovery. */
export const REGIONAL_FIXTURES = [
  { name: "aims-regional-merged-grch38.vcf", seed: 7, merged: true,
    weights: { AFR: 0.1, AMR: 0, CSA: 0.15, EAS: 0, EUR: 0.4, MID: 0.35, OCE: 0 } },
  { name: "aims-regional-separate-grch38.vcf", seed: 11, merged: false,
    weights: { AFR: 0.9, AMR: 0, CSA: 0, EAS: 0.1, EUR: 0, MID: 0, OCE: 0 } },
] as const;
