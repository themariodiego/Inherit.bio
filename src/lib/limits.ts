// Size caps per tier — the enforcement side of ADR-0001 (Gating Decision).
// Server storage enforces a global object cap too (supabase/config.toml and
// the hosted project's file_size_limit); these client caps must be <= that.
// Overridable per deployment via NEXT_PUBLIC_* env so self-hosters on Pro
// plans can raise them without code changes.

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const LIMITS = {
  /** Tier 1: array text/CSV (compressed or not). */
  arrayMaxBytes: envInt("NEXT_PUBLIC_MAX_ARRAY_BYTES", 100 * 1024 * 1024),
  /** Tier 1: VCF / VCF.GZ / gVCF. */
  vcfMaxBytes: envInt("NEXT_PUBLIC_MAX_VCF_BYTES", 200 * 1024 * 1024),
  /** Tier 2: BAM/CRAM stored (analyzed only via the self-host worker). */
  bamMaxBytes: envInt("NEXT_PUBLIC_MAX_BAM_BYTES", 5 * 1024 * 1024 * 1024),
} as const;

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${Math.round(n / 1024)} KB`;
}
