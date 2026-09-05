import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { chromToNumber } from "../genome/types";
import { embryoFileStream, embryoInputLines, EmbryoTransportError } from "./ingest-lines";
import { checkTransportBinding as checkBinding, checkTransportHandles as checkHandles,
  type EmbryoTransportBinding, type BrowserTransportBinding, type ServerTransportBinding } from "./ingest-binding";

/** The byte format is internal transport, never a source download. */
const VERSION = "##fileformat=VCFv4.5";
const COLUMNS = "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT";
const FORMAT = "GT:DP:GQ:AD:FT:LEN";
const DEFINITIONS = [
  '##ALT=<ID=NON_REF,Description="Unspecified alternate allele">',
  '##ALT=<ID=*,Description="Unspecified alternate allele">',
  '##FILTER=<ID=FAIL,Description="Source filter did not pass">',
  '##INFO=<ID=END,Number=1,Type=Integer,Description="End position">',
  '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
  '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read depth">',
  '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype quality">',
  '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allele depths">',
  '##FORMAT=<ID=FT,Number=1,Type=String,Description="Source genotype filter">',
  '##FORMAT=<ID=LEN,Number=1,Type=Integer,Description="Sample reference block length">',
];
const INTEGER = /^(0|[1-9][0-9]*)$/;
const BASES = /^[ACGTN]+$/;
const encoder = new TextEncoder();

function header(binding: EmbryoTransportBinding, handles: readonly string[]): string {
  return [VERSION, `##reference=${binding.build}`, `##inheritChallenge=${binding.challenge}:${binding.revision}`,
    ...DEFINITIONS, `${COLUMNS}\t${handles.join("\t")}`, ""].join("\n");
}

function integer(value: string, minimum = 0): string {
  if (!INTEGER.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
    throw new EmbryoTransportError("unrecognised_format");
  }
  return value;
}

function optionalInteger(value: string | undefined): string {
  return value === undefined || value === "." ? "." : integer(value);
}

function genotype(value: string | undefined, alleleCount: number): string {
  // VCF 4.4+ permits an initial phase separator. Phase information is not
  // retained without the source phase-set provenance.
  value = value?.replace(/^[/|]/, "");
  if (!value || !/^(\.|0|[1-9][0-9]*)([/|](\.|0|[1-9][0-9]*))*$/.test(value)) {
    throw new EmbryoTransportError("unrecognised_format");
  }
  for (const index of value.split(/[/|]/)) {
    if (index !== "." && (!Number.isSafeInteger(Number(index)) || Number(index) >= alleleCount)) {
      throw new EmbryoTransportError("unrecognised_format");
    }
  }
  // PS is deliberately not transported. Keeping | without PS would imply
  // one phase set across formerly separate blocks (VCF 4.3 section 1.6.2).
  return value.replaceAll("|", "/");
}

/**
 * Parse, then emit a closed set of fields. No INFO strings, annotations,
 * phase-set labels, filter names or arbitrary FORMAT values survive.
 * Reference blocks retain END and NON_REF; no reference call is invented.
 */
function cleanRecord(line: string, count: number): string | null {
  const fields = line.split("\t");
  if (fields.length !== 9 + count) throw new EmbryoTransportError("unrecognised_format");
  const chrom = chromToNumber(fields[0]);
  // Drop all non-autosomal content before interpreting its fields. Never
  // expose a discarded count, reason or presence marker to the caller.
  if (typeof chrom !== "number" || !Number.isInteger(chrom) || chrom < 1 || chrom > 22) return null;
  integer(fields[1], 1);
  fields[3] = fields[3].toUpperCase();
  fields[4] = fields[4].split(",").map((alt) => /^[acgtn]+$/i.test(alt) ? alt.toUpperCase() : alt).join(",");
  if (!BASES.test(fields[3])) throw new EmbryoTransportError("unrecognised_format");
  const alts = fields[4] === "." ? [] : fields[4].split(",");
  if (alts.some((alt) => !BASES.test(alt) && !["<NON_REF>", "<*>", "*"].includes(alt))) {
    // Breakends and symbolic structural alleles need a separately reviewed
    // representation: their arbitrary text can identify another contig.
    throw new EmbryoTransportError("unrecognised_format");
  }
  const format = fields[8].split(":");
  if (format[0] !== "GT" || new Set(format).size !== format.length) throw new EmbryoTransportError("unrecognised_format");
  const endFields = fields[7].split(";").filter((part) => part.startsWith("END="));
  if (endFields.length > 1) throw new EmbryoTransportError("unrecognised_format");
  const end = endFields.length ? integer(endFields[0].slice(4), Number(fields[1])) : null;
  const samples = fields.slice(9).map((sample) => {
    const values = sample.split(":");
    if (values.length > format.length) throw new EmbryoTransportError("unrecognised_format");
    const get = (key: string) => values[format.indexOf(key)];
    const gt = genotype(get("GT"), alts.length + 1);
    const rawAd = get("AD");
    let ad = ".";
    if (rawAd !== undefined && rawAd !== ".") {
      const depths = rawAd.split(",");
      if (depths.length !== alts.length + 1) throw new EmbryoTransportError("unrecognised_format");
      ad = depths.map((depth) => optionalInteger(depth)).join(",");
    }
    const sourceFilter = get("FT");
    const ft = sourceFilter === undefined || sourceFilter === "." ? "." : sourceFilter === "PASS" ? "PASS" : "FAIL";
    const rawLength = get("LEN");
    let length = ".";
    if (rawLength !== undefined && rawLength !== ".") {
      length = integer(rawLength, 1);
      if (!alts.some((alt) => alt === "<*>" || alt === "<NON_REF>") || !/^0(?:\/0)*$/.test(gt) ||
        !Number.isSafeInteger(Number(fields[1]) + Number(length) - 1)) throw new EmbryoTransportError("unrecognised_format");
    }
    return [gt, optionalInteger(get("DP")), optionalInteger(get("GQ")), ad, ft, length].join(":");
  });
  const rsids = fields[2].split(";");
  const id = rsids.filter((value) => /^rs[1-9][0-9]*$/.test(value));
  if (id.some((value) => !Number.isSafeInteger(Number(value.slice(2))))) throw new EmbryoTransportError("unrecognised_format");
  return [String(chrom), fields[1], id.length ? id.join(";") : ".", fields[3], fields[4], ".",
    fields[6] === "." || fields[6] === "PASS" ? fields[6] : "FAIL", end ? `END=${end}` : ".", FORMAT, ...samples].join("\t");
}

/**
 * Browser-side VCF/gVCF rewrite. Each yielded request starts with its own
 * regenerated, session-bound header and ends at a complete logical line.
 * A later error invalidates the whole attempt; yielded chunks are pending
 * input and must never be treated as permission to publish a cohort.
 */
export async function* embryoVcfChunks(file: Blob, inputBinding: BrowserTransportBinding): AsyncGenerator<Uint8Array> {
  const binding = { ...inputBinding, handles: [...inputBinding.handles] };
  checkBinding(binding);
  checkHandles(binding.handles, binding.sampleCount);
  const prefix = header(binding, binding.handles);
  const prefixBytes = encoder.encode(prefix).byteLength;
  let chunk = prefix;
  let chunkBytes = prefixBytes;
  let chunks = 0;
  let records = 0;
  let retained = false;
  let first = true;
  let columnsSeen = false;
  for await (const line of embryoInputLines(await embryoFileStream(file))) {
    if (first) {
      first = false;
      if (line.startsWith("%PDF-")) throw new EmbryoTransportError("pdf_not_data");
      if (!/^##fileformat=VCFv4\.[0-5]$/.test(line)) throw new EmbryoTransportError("unrecognised_format");
      continue;
    }
    if (!columnsSeen) {
      if (line.startsWith("##")) {
        if (line.startsWith("##fileformat=")) throw new EmbryoTransportError("unrecognised_format");
        if (line.startsWith("##reference=") || line.startsWith("##contig=")) {
          const versions = [...line.matchAll(/GRCh3[78]|hg(?:19|38)|b37/gi)].map((match) => /38/i.test(match[0]) ? "GRCh38" : "GRCh37");
          if (versions.some((value) => value !== binding.build)) throw new EmbryoTransportError("build_unknown");
        }
        continue;
      }
      const columns = line.split("\t");
      const labels = columns.slice(9);
      if (columns.slice(0, 9).join("\t") !== COLUMNS || labels.length !== binding.sampleCount ||
        new Set(labels).size !== labels.length || labels.some((label) => label.length === 0 || /\s/.test(label))) {
        throw new EmbryoTransportError("unrecognised_format");
      }
      columnsSeen = true;
      continue;
    }
    if (!line || line.startsWith("#")) throw new EmbryoTransportError("unrecognised_format");
    if (++records > LIMITS.maximumLogicalRecords) throw new EmbryoTransportError("too_large");
    const cleaned = cleanRecord(line, binding.sampleCount);
    if (cleaned === null) continue;
    const bytes = encoder.encode(cleaned).byteLength + 1;
    if (bytes > LIMITS.maximumLogicalLineBytes || prefixBytes + bytes > INGEST_CHUNK_MAXIMUM_BYTES) {
      throw new EmbryoTransportError("too_large");
    }
    if (chunkBytes + bytes > INGEST_CHUNK_MAXIMUM_BYTES) {
      if (++chunks >= LIMITS.maximumChunks) throw new EmbryoTransportError("too_large");
      yield encoder.encode(chunk);
      chunk = prefix;
      chunkBytes = prefixBytes;
    }
    chunk += `${cleaned}\n`;
    chunkBytes += bytes;
    retained = true;
  }
  if (!columnsSeen || !retained) throw new EmbryoTransportError("empty_after_parse");
  yield encoder.encode(chunk);
}

export interface EmbryoVcfFragment {
  ordinal: number;
  /** A regenerated single-sample VCF; no transport handle or challenge. */
  vcf: string;
}

/**
 * Validate the entire bounded chunk before returning anything to a storage
 * caller. Authentication, hash matching, sequence/quota reservation and
 * attempt-failure dispatch belong to the route's transaction, not here.
 */
export function validateEmbryoVcfChunk(bytes: Uint8Array, binding: ServerTransportBinding): EmbryoVcfFragment[] {
  checkBinding(binding);
  if (!bytes.length || bytes.length > INGEST_CHUNK_MAXIMUM_BYTES) throw new EmbryoTransportError("too_large");
  if (bytes[bytes.length - 1] !== 10) throw new EmbryoTransportError("invalid_chunk");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new EmbryoTransportError("invalid_chunk");
  }
  if (text.startsWith("%PDF-")) throw new EmbryoTransportError("pdf_not_data");
  const lines = text.split("\n");
  lines.pop();
  const columnAt = 3 + DEFINITIONS.length;
  const handles = (lines[columnAt] ?? "").split("\t").slice(9);
  checkHandles(handles, binding.sampleCount);
  if (handles.some((handle, ordinal) => binding.resolveHandle(handle) !== ordinal)) throw new EmbryoTransportError("invalid_session");
  const prefix = header(binding, handles);
  if (!text.startsWith(prefix)) throw new EmbryoTransportError("invalid_chunk");
  const records = lines.slice(columnAt + 1);
  if (!records.length || records.length > LIMITS.maximumLogicalRecords) throw new EmbryoTransportError("empty_after_parse");
  const parts = Array.from({ length: binding.sampleCount }, () => [] as string[]);
  for (const line of records) {
    if (encoder.encode(line).byteLength + 1 > LIMITS.maximumLogicalLineBytes) throw new EmbryoTransportError("too_large");
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) throw new EmbryoTransportError("invalid_chunk");
    const cleaned = cleanRecord(line, binding.sampleCount);
    if (cleaned === null) continue;
    // Re-serialization equality prevents extra INFO/FORMAT/ID strings or
    // unselected columns entering storage even from a bypassed browser.
    if (cleaned !== line) throw new EmbryoTransportError("invalid_chunk");
    const fields = cleaned.split("\t");
    for (let ordinal = 0; ordinal < binding.sampleCount; ordinal++) {
      const fixed = fields.slice(0, 9);
      const sample = fields[9 + ordinal];
      const length = sample.split(":").at(-1)!;
      // INFO/END in a multi-sample file can be the maximum of different
      // per-sample LEN values. A single-sample fragment gets its own end.
      if (length !== ".") fixed[7] = `END=${Number(fields[1]) + Number(length) - 1}`;
      parts[ordinal].push([...fixed, sample].join("\t"));
    }
  }
  if (!parts[0].length) throw new EmbryoTransportError("empty_after_parse");
  return parts.map((rows, ordinal) => ({ ordinal, vcf: [VERSION, `##reference=${binding.build}`, ...DEFINITIONS,
    `${COLUMNS}\tEmbryo_${ordinal + 1}`, ...rows, ""].join("\n") }));
}
