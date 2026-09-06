const LEGACY_LABEL: Record<string, string> = {
  uploading: "Uploading", uploaded: "Awaiting processing", parsing: "Processing…",
  parsed: "Parsed", annotated: "Processed", failed: "Failed", stored: "Stored",
};

/** A prepared ordinary file is not a Tier-2 archive or a generated report. */
export function fileStatusLabel(file: { status: string; tier: number;
  single_logical_sample_verified_at: string | null; normalization_completed_at: string | null }) {
  if (file.tier === 1 && file.single_logical_sample_verified_at !== null) {
    if (file.status === "stored" && file.normalization_completed_at !== null) return "Prepared";
    if (file.status === "uploaded") return "Awaiting preparation";
    if (file.status === "parsing") return "Preparing…";
  }
  if (file.tier === 2 && file.status === "stored") return "Stored (Tier 2)";
  return LEGACY_LABEL[file.status] ?? file.status;
}
