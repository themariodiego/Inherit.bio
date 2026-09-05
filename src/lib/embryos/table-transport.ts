import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "../genome/ingest-limits";
import { detectPgtHeader, type CompleteMapping, type PgtDelimiter } from "../genome/parsers/pgt-table";
import { chromToNumber } from "../genome/types";
import { embryoFileStream, embryoInputLines, EmbryoTransportError } from "./ingest-lines";
import { checkTransportBinding, checkTransportHandles, resolveTransportHandle,
  type BrowserTransportBinding, type EmbryoTransportBinding, type ServerTransportBinding } from "./ingest-binding";

const encoder = new TextEncoder();
type LocusKind = CompleteMapping["locus"]["kind"];

/** Complete, session-confirmed mapping only; the challenge UI lives elsewhere. */
export interface TableBrowserBinding extends BrowserTransportBinding {
  mapping: CompleteMapping;
}

export interface TableServerBinding extends ServerTransportBinding {
  /** The server's stored mapping decision, never read from the request body. */
  locusKind: LocusKind;
  /** Reference-store lookup in the resolved build, not client-supplied loci. */
  resolveRsid: (rsid: number, build: EmbryoTransportBinding["build"]) => { chrom: number; pos: number } | null;
}

function header(binding: EmbryoTransportBinding, kind: LocusKind): string {
  return ["##inheritTable=1", `##reference=${binding.build}`, `##inheritChallenge=${binding.challenge}:${binding.revision}`,
    kind === "rsid" ? "sample\trsid\tgenotype" : "sample\tchrom\tpos\tgenotype", ""].join("\n");
}

/** Reject broken quoting; source records must fit one bounded logical line. */
function cells(line: string, delimiter: PgtDelimiter): string[] {
  const result: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (line[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === delimiter) {
      result.push(cell.trim()); cell = ""; closed = false;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === '"' || (closed && char.trim() !== "")) throw new EmbryoTransportError("unrecognised_format");
    else cell += char;
  }
  if (quoted) throw new EmbryoTransportError("unrecognised_format");
  result.push(cell.trim());
  return result;
}

function positiveInteger(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new EmbryoTransportError("unrecognised_format");
  return Number(value);
}

function rsid(value: string): number {
  if (!/^rs[1-9][0-9]*$/i.test(value)) throw new EmbryoTransportError("unrecognised_format");
  return positiveInteger(value.slice(2));
}

function autosome(raw: string): number | null {
  const chrom = chromToNumber(raw);
  return typeof chrom === "number" && Number.isInteger(chrom) && chrom >= 1 && chrom <= 22 ? chrom : null;
}

function call(value: string): string {
  const upper = value.toUpperCase();
  if (["--", "-", ".", "./."].includes(upper)) return "./.";
  if (/^[ACGT]{2}$/.test(upper)) return `${upper[0]}/${upper[1]}`;
  // Sequence alleles separated by / or |, or a single called base. An
  // unseparated multi-base string is never guessed to be a haploid indel.
  if (/^[ACGT]$/.test(upper) || /^(?:[ACGT]+|\.)(?:[/|](?:[ACGT]+|\.))+$/.test(upper)) return upper.replaceAll("|", "/");
  throw new EmbryoTransportError("unrecognised_format");
}

export async function* embryoTableChunks(file: Blob, inputBinding: TableBrowserBinding): AsyncGenerator<Uint8Array> {
  const binding: TableBrowserBinding = { ...inputBinding, handles: [...inputBinding.handles],
    mapping: { ...inputBinding.mapping, identifier: { ...inputBinding.mapping.identifier }, locus: { ...inputBinding.mapping.locus } } };
  checkTransportBinding(binding);
  checkTransportHandles(binding.handles, binding.sampleCount);
  const mapping = binding.mapping;
  const prefix = header(binding, mapping.locus.kind);
  const prefixBytes = encoder.encode(prefix).byteLength;
  let chunk = prefix;
  let chunkBytes = prefixBytes;
  let chunks = 0;
  let records = 0;
  let hasRow = false;
  let sourceHeader: ReturnType<typeof detectPgtHeader> = null;
  const samples = new Map<string, number>();
  try {
    for await (const line of embryoInputLines(await embryoFileStream(file))) {
      if (!sourceHeader) {
        if (line.startsWith("%PDF-")) throw new EmbryoTransportError("pdf_not_data");
        sourceHeader = detectPgtHeader(line);
        if (!sourceHeader) throw new EmbryoTransportError("unrecognised_format");
        // Validate syntax separately: detection alone is deliberately lenient.
        cells(line, sourceHeader.delimiter);
        const selected = [mapping.identifier.column, mapping.genotype, ...(mapping.locus.kind === "rsid"
          ? [mapping.locus.column] : [mapping.locus.chrom, mapping.locus.pos])];
        const fields = [mapping.identifier.field, "genotype", ...(mapping.locus.kind === "rsid" ? ["rsid"] : ["chrom", "pos"])];
        if (new Set(selected).size !== selected.length || selected.some((index, at) => !Number.isInteger(index) || index < 0 ||
          index >= sourceHeader!.columnCount || sourceHeader!.forbidden.includes(index) ||
          (sourceHeader!.resolved[index] !== null && sourceHeader!.resolved[index] !== fields[at]))) {
          throw new EmbryoTransportError("unrecognised_format");
        }
        continue;
      }
      if (++records > LIMITS.maximumLogicalRecords) throw new EmbryoTransportError("too_large");
      const values = cells(line, sourceHeader.delimiter);
      if (values.length !== sourceHeader.columnCount) throw new EmbryoTransportError("unrecognised_format");
      const label = values[mapping.identifier.column];
      if (!label) throw new EmbryoTransportError("unrecognised_format");
      let ordinal = samples.get(label);
      if (ordinal === undefined) {
        ordinal = samples.size;
        if (ordinal >= binding.sampleCount) throw new EmbryoTransportError("invalid_session");
        samples.set(label, ordinal);
      }
      let locus: string[];
      if (mapping.locus.kind === "rsid") {
        // If a source also states a chromosome, drop known non-autosomal
        // rows in the browser. The server independently resolves every rsID.
        const chromColumns = sourceHeader.columns.chrom;
        const optionalChrom = chromColumns.length === 1 ? values[chromColumns[0]] : "";
        if (optionalChrom !== "" && optionalChrom !== "." && autosome(optionalChrom) === null) continue;
        locus = [`rs${rsid(values[mapping.locus.column])}`];
      } else {
        const chrom = autosome(values[mapping.locus.chrom]);
        if (chrom === null) continue;
        locus = [String(chrom), String(positiveInteger(values[mapping.locus.pos]))];
      }
      const record = [binding.handles[ordinal], ...locus, call(values[mapping.genotype])].join("\t") + "\n";
      const size = encoder.encode(record).byteLength;
      if (size > LIMITS.maximumLogicalLineBytes || prefixBytes + size > INGEST_CHUNK_MAXIMUM_BYTES) throw new EmbryoTransportError("too_large");
      if (chunkBytes + size > INGEST_CHUNK_MAXIMUM_BYTES) {
        if (++chunks >= LIMITS.maximumChunks) throw new EmbryoTransportError("too_large");
        yield encoder.encode(chunk);
        chunk = prefix; chunkBytes = prefixBytes;
      }
      chunk += record; chunkBytes += size; hasRow = true;
    }
    if (!hasRow) throw new EmbryoTransportError("empty_after_parse");
    if (samples.size !== binding.sampleCount) throw new EmbryoTransportError("invalid_session");
    yield encoder.encode(chunk);
  } finally {
    // Raw labels have no caller-visible return path and no durable sink.
    // JavaScript strings cannot be securely zeroized; release references.
    samples.clear();
  }
}

export interface EmbryoTableRecord {
  ordinal: number;
  chrom: number;
  pos: number;
  rsid: number | null;
  genotype: string;
}

/** Validate a whole request before handing normalized rows to a writer. */
export function validateEmbryoTableChunk(bytes: Uint8Array, binding: TableServerBinding): EmbryoTableRecord[] {
  checkTransportBinding(binding);
  if (!["rsid", "chrom-pos"].includes(binding.locusKind)) throw new EmbryoTransportError("invalid_session");
  if (!bytes.length || bytes.length > INGEST_CHUNK_MAXIMUM_BYTES) throw new EmbryoTransportError("too_large");
  if (bytes[bytes.length - 1] !== 10) throw new EmbryoTransportError("invalid_chunk");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new EmbryoTransportError("invalid_chunk"); }
  if (text.startsWith("%PDF-")) throw new EmbryoTransportError("pdf_not_data");
  const prefix = header(binding, binding.locusKind);
  if (!text.startsWith(prefix)) throw new EmbryoTransportError("invalid_chunk");
  const lines = text.slice(prefix.length, -1).split("\n");
  const records: EmbryoTableRecord[] = [];
  if (lines.length > LIMITS.maximumLogicalRecords) throw new EmbryoTransportError("too_large");
  for (const line of lines) {
    if (encoder.encode(line).byteLength + 1 > LIMITS.maximumLogicalLineBytes) throw new EmbryoTransportError("too_large");
    const fields = line.split("\t");
    if (fields.length !== (binding.locusKind === "rsid" ? 3 : 4)) throw new EmbryoTransportError("invalid_chunk");
    const ordinal = resolveTransportHandle(fields[0], binding);
    let locus: { chrom: number; pos: number } | null;
    let id: number | null = null;
    if (binding.locusKind === "rsid") {
      id = rsid(fields[1]);
      if (fields[1] !== `rs${id}`) throw new EmbryoTransportError("invalid_chunk");
      locus = binding.resolveRsid(id, binding.build);
      if (!locus) throw new EmbryoTransportError("unrecognised_format");
    } else {
      const chrom = autosome(fields[1]);
      if (chrom === null) continue;
      if (fields[1] !== String(chrom)) throw new EmbryoTransportError("invalid_chunk");
      locus = { chrom, pos: positiveInteger(fields[2]) };
    }
    if (!Number.isInteger(locus.chrom) || locus.chrom < 1 || locus.chrom > 22) continue;
    if (!Number.isSafeInteger(locus.pos) || locus.pos <= 0) throw new EmbryoTransportError("unrecognised_format");
    const genotype = fields.at(-1)!;
    if (call(genotype) !== genotype) throw new EmbryoTransportError("invalid_chunk");
    records.push({ ordinal, chrom: locus.chrom, pos: locus.pos, rsid: id, genotype });
  }
  // An rsID-only chunk may resolve entirely to excluded chromosomes. It
  // writes zero rows; completion must still require retained cohort data.
  return records;
}
