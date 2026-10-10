import { vcfQcFigureBasis, type QcFigureBasis } from "./qc-basis";
import { streamVcf } from "../genome/parsers/vcf";
import { EmbryoTransportError } from "./ingest-lines";
import type { EmbryoTransportBinding } from "./ingest-binding";
import { mapQcReason, qcBand, qcReasons, type QcBand, type QcReasonId } from "./qc-policy";
import { validateEmbryoVcfFragment } from "./vcf-transport";

/**
 * The per-embryo half of `split_cohort_vcf`, with no database and no network.
 *
 * One embryo's genotypes come only from that embryo's own fragments. A
 * no-call, a partial call or a filtered call is counted as not called and is
 * never written: nothing is filled in from a parent, a sibling, another
 * fragment or a reference panel (ADR 0020 decision 3, ADR 0003). The product
 * VCF parser (`streamVcf`) reads every genotype; the stored fragment is
 * revalidated byte for byte first. QC bands and reasons come only from
 * `qc-policy.ts`. Nothing here reads a sex chromosome: a fragment that names
 * one fails revalidation.
 */

/** [chromosome, position, reference, called alternates or null, genotype]. */
export type EmbryoSplitRow = [number, number, string, string | null, string];

export interface EmbryoFragmentMeasure {
  /** Record lines in the fragment. */
  sites: number;
  /** Records with every allele called and no failed filter. */
  called: number;
  /** Called records with two alleles. */
  diploidCalled: number;
  /** Diploid called records whose two alleles differ. */
  heterozygous: number;
  depthSum: number;
  depthCount: number;
  /** Rows handed to `onRow`. */
  rows: number;
}

export function emptyMeasure(): EmbryoFragmentMeasure {
  return { sites: 0, called: 0, diploidCalled: 0, heterozygous: 0, depthSum: 0, depthCount: 0, rows: 0 };
}

export function addMeasures(left: EmbryoFragmentMeasure, right: EmbryoFragmentMeasure): EmbryoFragmentMeasure {
  return { sites: left.sites + right.sites, called: left.called + right.called,
    diploidCalled: left.diploidCalled + right.diploidCalled, heterozygous: left.heterozygous + right.heterozygous,
    depthSum: left.depthSum + right.depthSum, depthCount: left.depthCount + right.depthCount, rows: left.rows + right.rows };
}

const LITERAL = /^[ACGTN]+$/;

/**
 * Revalidate one fragment, measure it and hand each storable called genotype
 * to `onRow` in file order. Throws `EmbryoTransportError` on any mismatch:
 * `build_unknown` when it names another build, otherwise a format code.
 */
export async function analyseEmbryoFragment(bytes: Uint8Array, ordinal: number,
  build: EmbryoTransportBinding["build"], onRow: (row: EmbryoSplitRow) => void | Promise<void>): Promise<EmbryoFragmentMeasure> {
  const lines = validateEmbryoVcfFragment(bytes, ordinal, build);
  const measure = emptyMeasure();
  const uncalledLines = new Set<number>();
  let missing = 0;
  lines.forEach((line, index) => {
    if (line.startsWith("#")) return;
    const fields = line.split("\t");
    const sample = fields[9].split(":");
    const alleles = sample[0].split("/");
    const filtered = fields[6] === "FAIL" || sample[4] === "FAIL";
    measure.sites++;
    if (alleles.includes(".")) missing++;
    if (alleles.includes(".") || filtered) {
      uncalledLines.add(index + 1);
      return;
    }
    measure.called++;
    if (alleles.length === 2) {
      measure.diploidCalled++;
      if (alleles[0] !== alleles[1]) measure.heterozygous++;
    }
    if (sample[1] !== ".") {
      measure.depthSum += Number(sample[1]);
      measure.depthCount++;
    }
  });
  // The transport always writes FORMAT `GT:DP:GQ:AD:FT:LEN`, with LEN `.`
  // when the record is not a reference block. The product parser reads any
  // LEN in FORMAT as a block (a range, not a call), so an empty LEN is
  // dropped before parsing; a real block keeps it and stays a range.
  async function* source() {
    for (const line of lines) {
      if (line.startsWith("#")) { yield line; continue; }
      const fields = line.split("\t");
      const sample = fields[9].split(":");
      if (sample[5] === ".") {
        fields[8] = "GT:DP:GQ:AD:FT";
        fields[9] = sample.slice(0, 5).join(":");
      }
      yield fields.join("\t");
    }
  }
  let summary = false;
  for await (const event of streamVcf(source())) {
    if (event.type === "summary") {
      // The product parser must agree with the revalidation on the build and
      // on exactly which records were no-calls.
      if (event.build !== build) throw new EmbryoTransportError("build_unknown");
      if (event.skipped !== missing) throw new EmbryoTransportError("invalid_chunk");
      summary = true;
      continue;
    }
    if (event.type === "observed" || uncalledLines.has(event.line)) continue;
    const genotype = event.type === "variant" ? event.record.genotype : event.call.genotype;
    const ref = event.type === "variant" ? event.record.ref : event.call.ref;
    const alt = event.type === "variant" ? event.record.alt : null;
    const chrom = event.type === "variant" ? event.record.chrom : event.call.chrom;
    const pos = event.type === "variant" ? event.record.pos : event.call.pos;
    if (!Number.isInteger(chrom) || chrom < 1 || chrom > 22) throw new EmbryoTransportError("invalid_chunk");
    // A spanning-deletion allele has no literal sequence to store; the site
    // still counts as called, but no row claims a base that was not observed.
    const parts = genotype.split("/");
    if (ref === null || !LITERAL.test(ref) || parts.some((allele) => !LITERAL.test(allele))
      || (alt !== null && alt.split(",").some((allele) => !LITERAL.test(allele)))) continue;
    measure.rows++;
    await onRow([chrom, pos, ref, alt, genotype]);
  }
  if (!summary) throw new EmbryoTransportError("invalid_chunk");
  return measure;
}

export interface EmbryoQcMeasurement {
  figure_basis: QcFigureBasis;
  sites_expected: number;
  sites_called: number;
  call_rate: number;
  autosomal_het_rate: number | null;
  mean_depth: number | null;
  qc_verdict: QcBand;
  qc_reasons: QcReasonId[];
}

export interface EmbryoOrdinalOutcome {
  outcome: "passed" | "qc_fail_no_source";
  qc: EmbryoQcMeasurement;
  failureReason: QcReasonId | null;
  variantCount: number;
}

/**
 * One embryo's QC from its own measured calls. Parent concordance, allelic
 * dropout and contamination need inputs this file does not carry, so they
 * are null and never estimated; `qc-policy.ts` treats null as not measured.
 * A pass or marginal embryo with no storable genotype fails closed as
 * `qc_review_required` rather than publishing an empty source.
 */
export function embryoOrdinalOutcome(measure: EmbryoFragmentMeasure): EmbryoOrdinalOutcome {
  if (!Number.isSafeInteger(measure.sites) || measure.sites < 1) throw new EmbryoTransportError("empty_after_parse");
  const callRate = measure.called / measure.sites;
  const metrics = { call_rate: callRate, parent_a_concordance: null, parent_b_concordance: null,
    allelic_dropout_estimate: null, contamination_estimate: null };
  let verdict = qcBand(metrics);
  let reasons = qcReasons(metrics);
  if (verdict !== "fail" && measure.rows === 0) {
    verdict = "fail";
    reasons = [...reasons, "qc_review_required"];
  }
  const autosomal_het_rate = measure.diploidCalled > 0 ? measure.heterozygous / measure.diploidCalled : null;
  const mean_depth = measure.depthCount > 0 ? measure.depthSum / measure.depthCount : null;
  const qc: EmbryoQcMeasurement = {
    figure_basis: vcfQcFigureBasis({ autosomal_het_rate, mean_depth }),
    sites_expected: measure.sites,
    sites_called: measure.called,
    call_rate: callRate,
    autosomal_het_rate,
    mean_depth,
    qc_verdict: verdict,
    qc_reasons: reasons,
  };
  if (verdict === "fail") {
    return { outcome: "qc_fail_no_source", qc, failureReason: mapQcReason(reasons[0] ?? "qc_review_required"),
      variantCount: 0 };
  }
  return { outcome: "passed", qc, failureReason: null, variantCount: measure.rows };
}
