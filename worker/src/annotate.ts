// annotate_vcf pipeline stage: download a VCF from Supabase Storage, parse it
// line by line, and join variants against public.ref_variants by (chrom, pos38).
//
// Self-contained on purpose: the worker is a separate app and must not import
// from the web app's src/. Chromosomes are numeric: 1-22, X=23, Y=24, MT=25.

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

/** Minimal query surface so tests can mock pg without depending on it. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface AnnotatePayload {
  file_id: string;
  user_id: string;
  bucket_path: string;
}

export interface VcfVariant {
  chrom: number;
  pos: number;
  rsid: number | null;
  ref: string;
  /** Raw ALT field; may be comma-separated for multi-allelic sites. */
  alt: string;
  /** GT subfield of the first sample, e.g. "0/1"; null when absent. */
  genotype: string | null;
}

export interface ClinvarHit {
  rsid: number;
  gene: string | null;
  significance: string;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string | null;
}

export interface AnnotateResult {
  total: number;
  annotated: number;
  clinvar_hits: ClinvarHit[];
}

interface RefVariantRow {
  rsid: string | number; // pg returns bigint as string
  chrom: number;
  pos38: number;
  ref: string | null;
  alt: string | null;
  gene_symbol: string | null;
  clinvar_significance: string | null;
}

const BATCH_SIZE = 500;
const MAX_CLINVAR_HITS = 200;

/** "chr1"/"1" -> 1, X -> 23, Y -> 24, MT/M -> 25; null for scaffolds. */
export function chromToNumber(raw: string): number | null {
  const name = raw.replace(/^chr/i, "").toUpperCase();
  if (name === "X") return 23;
  if (name === "Y") return 24;
  if (name === "MT" || name === "M") return 25;
  const n = Number(name);
  return Number.isInteger(n) && n >= 1 && n <= 22 ? n : null;
}

/**
 * Parses one VCF data line (CHROM POS ID REF ALT QUAL FILTER INFO [FORMAT SAMPLE]).
 * Returns null for headers, blank lines, scaffolds, and unparseable lines.
 */
export function parseVcfLine(line: string): VcfVariant | null {
  if (!line || line.startsWith("#")) return null;
  const f = line.split("\t");
  if (f.length < 8) return null;
  const chrom = chromToNumber(f[0]);
  const pos = Number(f[1]);
  if (chrom === null || !Number.isInteger(pos) || pos <= 0) return null;
  const idMatch = /^rs(\d+)$/i.exec(f[2].trim());
  let genotype: string | null = null;
  if (f.length >= 10) {
    const gtIndex = f[8].split(":").indexOf("GT");
    if (gtIndex !== -1) genotype = f[9].split(":")[gtIndex] ?? null;
  }
  return {
    chrom,
    pos,
    rsid: idMatch ? Number(idMatch[1]) : null,
    ref: f[3],
    alt: f[4],
    genotype,
  };
}

const REF_JOIN_SQL = `
  select r.rsid, r.chrom, r.pos38, r.ref, r.alt, r.gene_symbol, r.clinvar_significance
  from public.ref_variants r
  join unnest($1::smallint[], $2::integer[]) as q(chrom, pos)
    on r.chrom = q.chrom and r.pos38 = q.pos`;

// Pathogenic/Likely_pathogenic, but not "Conflicting_interpretations_of_pathogenicity".
function isPathogenic(significance: string | null): significance is string {
  return (
    significance !== null &&
    /pathogenic/i.test(significance) &&
    !/conflicting/i.test(significance)
  );
}

async function flushBatch(
  batch: VcfVariant[],
  db: Queryable,
  result: AnnotateResult,
): Promise<void> {
  const byKey = new Map<string, VcfVariant[]>();
  for (const v of batch) {
    const key = `${v.chrom}:${v.pos}`;
    const list = byKey.get(key);
    if (list) list.push(v);
    else byKey.set(key, [v]);
  }
  const chroms: number[] = [];
  const positions: number[] = [];
  for (const list of byKey.values()) {
    chroms.push(list[0].chrom);
    positions.push(list[0].pos);
  }
  const { rows } = await db.query(REF_JOIN_SQL, [chroms, positions]);
  const annotated = new Set<VcfVariant>();
  for (const row of rows as RefVariantRow[]) {
    for (const v of byKey.get(`${row.chrom}:${row.pos38}`) ?? []) {
      annotated.add(v);
      if (isPathogenic(row.clinvar_significance) && result.clinvar_hits.length < MAX_CLINVAR_HITS) {
        result.clinvar_hits.push({
          rsid: Number(row.rsid),
          gene: row.gene_symbol,
          significance: row.clinvar_significance,
          chrom: row.chrom,
          pos: row.pos38,
          ref: row.ref,
          alt: row.alt,
          genotype: v.genotype,
        });
      }
    }
  }
  result.annotated += annotated.size;
}

/**
 * Streams VCF lines, joins against ref_variants in batches of BATCH_SIZE
 * positions. Never buffers the file: memory is bounded by one batch.
 */
export async function annotateLines(
  lines: AsyncIterable<string> | Iterable<string>,
  db: Queryable,
): Promise<AnnotateResult> {
  const result: AnnotateResult = { total: 0, annotated: 0, clinvar_hits: [] };
  let batch: VcfVariant[] = [];
  for await (const line of lines) {
    const v = parseVcfLine(line);
    if (!v) continue;
    result.total++;
    batch.push(v);
    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch, db, result);
      batch = [];
    }
  }
  if (batch.length > 0) await flushBatch(batch, db, result);
  return result;
}

export interface StorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Downloads the object from the private "genomes" bucket via the Storage REST
 * API and yields decompressed lines without buffering the file.
 */
export async function downloadVcfLines(
  bucketPath: string,
  env: StorageEnv,
): Promise<AsyncIterable<string>> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const url = `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/genomes/${bucketPath}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`storage download failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  let stream: Readable = Readable.fromWeb(
    res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  if (bucketPath.endsWith(".gz")) stream = stream.pipe(createGunzip());
  return createInterface({ input: stream, crlfDelay: Infinity });
}

export async function runAnnotateJob(
  db: Queryable,
  payload: AnnotatePayload,
  env: StorageEnv,
): Promise<AnnotateResult> {
  const lines = await downloadVcfLines(payload.bucket_path, env);
  return annotateLines(lines, db);
}
