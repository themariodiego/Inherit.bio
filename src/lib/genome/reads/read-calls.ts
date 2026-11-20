import { ReadFileError } from "./binary";
import { blobChunks, gunzipMember, isBgzf } from "./bgzf";
import { openBam } from "./bam";
import { openCram, type ReferenceLookup } from "./cram";
import { callLoci, type LocusCall } from "./caller";
import { looksLikeFasta, parseFasta, referenceLookup } from "./fasta";
import { assertGrch38, panelLoci, type ReadCallingPanel } from "./panel";
import { writeReadCallVcf, type ReadInput } from "./read-call-vcf";
import { READ_CALLING_THRESHOLDS, type ReadCallingThresholds } from "./thresholds";

/**
 * Sequence reads in, one single-sample VCF out (G7.4, ADR 0038). Runs on the
 * person's device: the reads are read here, called at the product's
 * positions, and only the resulting VCF is offered to the existing upload.
 * Nothing from the reads is sent anywhere by this module.
 */

export interface ReadCallSummary {
  input: ReadInput;
  positions: number;
  called: number;
  noCall: number;
  notCovered: number;
}

export interface ReadCallResult {
  vcf: string;
  summary: ReadCallSummary;
  calls: LocusCall[];
}

/** Which kind of reads file the first bytes describe, or null. */
export async function readFileKind(head: Uint8Array): Promise<ReadInput | null> {
  if (head.length >= 4 && head[0] === 0x43 && head[1] === 0x52 && head[2] === 0x41 && head[3] === 0x4d) return "CRAM";
  if (!isBgzf(head)) return null;
  const blockSize = (head[16] | (head[17] << 8)) + 1;
  if (head.length < blockSize) return null;
  try {
    const payload = await gunzipMember(head.subarray(0, blockSize));
    return payload[0] === 0x42 && payload[1] === 0x41 && payload[2] === 0x4d && payload[3] === 0x01 ? "BAM" : null;
  } catch { return null; }
}

/** The reads, chunk by chunk, reporting how much has been read. */
async function* reported(blob: Blob, onProgress?: (fraction: number) => void): AsyncGenerator<Uint8Array> {
  let read = 0;
  for await (const chunk of blobChunks(blob)) {
    read += chunk.length;
    onProgress?.(blob.size ? read / blob.size : 1);
    yield chunk;
  }
}

export async function callReadsFile(input: {
  reads: Blob; reference: Blob | null; panel: ReadCallingPanel; thresholds?: ReadCallingThresholds;
  onProgress?: (fraction: number) => void;
}): Promise<ReadCallResult> {
  const thresholds = input.thresholds ?? READ_CALLING_THRESHOLDS;
  const head = new Uint8Array(await input.reads.slice(0, 65_536 + 26).arrayBuffer());
  const kind = await readFileKind(head);
  if (!kind) throw new ReadFileError("unreadable_reads");
  let opened;
  if (kind === "BAM") {
    opened = await openBam(reported(input.reads, input.onProgress));
  } else {
    // The CRAM's own structure is checked before its reference is asked for,
    // so a file that is not CRAM at all says so rather than asking for one.
    let lookup: ReferenceLookup | null = null;
    opened = await openCram(reported(input.reads, input.onProgress), (reference) => lookup?.(reference) ?? null);
    if (!input.reference) throw new ReadFileError("reference_required");
    const referenceHead = new Uint8Array(await input.reference.slice(0, 2).arrayBuffer());
    if (!looksLikeFasta(referenceHead)) throw new ReadFileError("reference_mismatch");
    const genome = await parseFasta(new Uint8Array(await input.reference.arrayBuffer()));
    lookup = referenceLookup(genome, opened.header.references);
  }
  const references = opened.header.references;
  assertGrch38(references);
  const loci = panelLoci(input.panel, references);
  const calls = await callLoci(opened.records, references, loci, thresholds);
  const summary: ReadCallSummary = {
    input: kind, positions: loci.length,
    called: calls.filter((call) => call.state === "called").length,
    noCall: calls.filter((call) => call.state === "no_call").length,
    notCovered: calls.filter((call) => call.state === "not_covered").length,
  };
  if (summary.called + summary.noCall === 0) throw new ReadFileError("nothing_covered");
  const vcf = writeReadCallVcf(calls, { input: kind, contigOrder: references.map((reference) => reference.name), thresholds });
  return { vcf, summary, calls };
}
