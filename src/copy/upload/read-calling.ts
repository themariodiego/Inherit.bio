/**
 * Uploader copy for calling genotypes from sequence reads (G7.4, ADR 0038).
 * TEST-LOCAL only: production keeps `OWN_UPLOAD_COPY.sequenceReadsUnavailable`
 * and never renders any of these strings.
 */
export const READ_CALLING_COPY = {
  available:
    "In this test build you can also choose a BAM file, or a CRAM file together with its reference FASTA file. Inherit reads it on your device and calls genotypes only at the positions its reports use. It saves those calls as a VCF file, never your reads.",
  calling: (percent: number) => `Calling genotypes from your reads on this device… ${percent}%`,
  saved: (called: number, noCall: number) =>
    `Inherit called ${called} positions from your reads and could not read ${noCall} confidently. Only these calls are uploaded, never your reads.`,
  unreviewed: "The calling thresholds are engineering defaults. No scientist has reviewed them yet.",
  refusals: {
    reads_reference_required:
      "A CRAM file needs the reference FASTA file it was made with. Choose both files together. No file was uploaded.",
    reads_reference_mismatch:
      "This reference does not match the CRAM file. Choose the FASTA file it was made with. No file was uploaded.",
    reads_unsupported_compression:
      "This file uses a compression method Inherit cannot read yet. No file was uploaded.",
    reads_unsupported_build:
      "Inherit can call genotypes only from reads aligned to GRCh38, and this file does not say it is. No file was uploaded.",
    reads_nothing_covered:
      "No reads in this file cover the positions Inherit’s reports use. No file was uploaded.",
    reads_reference_too_large:
      "This reference file is too large to open on your device. No file was uploaded.",
  },
} as const;
