/**
 * Laboratory genotype tables (`pgt_table`) — the header rule and the
 * column-mapping plan (brief A.6 lines 2188-2192; register
 * `policyContracts.genetic-file-ingest-v1.pgtTable`). Pure and
 * runtime-agnostic: the browser preflight and the server's own repeat of the
 * detection both run this code, and the server never trusts the browser's
 * answer.
 *
 * The rule, exactly as bound: each header cell is lower-cased and stripped
 * of every non-alphanumeric character, then matched by exact equality
 * against `data/ref/lab-tables/column-synonyms.json`. Substring and fuzzy
 * matching are forbidden. A file is a `pgt_table` when at least three of
 * `sample`, `embryo`, `rsid`, `genotype`, `chrom`, `pos` resolve.
 *
 * The mapping plan is the register's `ambiguity` rule: zero decisions when
 * the header resolves the minimum usable mapping (one sample or embryo
 * identifier, a genotype, and a locus from `rsid` or `chrom` + `pos`); at
 * most four column decisions otherwise; and no plan at all beyond four,
 * which sends the reader to the request-data letter rather than to a
 * spreadsheet chore. A decision names neutral column indexes, never a
 * source value.
 *
 * Header cells naming a sex, gender or karyotype column are reported as
 * forbidden so the browser drops them before any byte leaves it and the
 * server refuses them before any write (X10.2). Nothing here reads a data
 * row.
 */
import synonyms from "../../../../data/ref/lab-tables/column-synonyms.json";

export const PGT_FIELDS = ["sample", "embryo", "rsid", "genotype", "chrom", "pos"] as const;
export type PgtField = (typeof PGT_FIELDS)[number];

/** The register's detection rule: at least this many distinct fields resolve. */
export const PGT_DETECTION_MINIMUM_FIELDS = 3;

/** The register's `ambiguity` rule: never more decisions than this. */
export const MAXIMUM_MAPPING_DECISIONS = 4;

interface SynonymTable {
  schemaVersion: number;
  note: string;
  fields: Record<PgtField, readonly string[]>;
  forbidden: readonly string[];
}

const TABLE = synonyms as SynonymTable;

/** Lower-case, then keep only ASCII letters and digits (the register's `headerNormalization`). */
export function normaliseHeaderCell(cell: string): string {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SYNONYM_TO_FIELD: ReadonlyMap<string, PgtField> = new Map(
  PGT_FIELDS.flatMap((field) => [field, ...TABLE.fields[field]].map((name) => [normaliseHeaderCell(name), field] as const)),
);

const FORBIDDEN = new Set(TABLE.forbidden.map(normaliseHeaderCell));

/** The field one header cell resolves to by exact equality, or null. */
export function resolveHeaderCell(cell: string): PgtField | null {
  return SYNONYM_TO_FIELD.get(normaliseHeaderCell(cell)) ?? null;
}

/** True for a header cell that names a sex, gender or karyotype column. */
export function isForbiddenHeaderCell(cell: string): boolean {
  return FORBIDDEN.has(normaliseHeaderCell(cell));
}

export type PgtDelimiter = "\t" | ",";

/**
 * Tab when the line carries one, otherwise comma. Cells follow RFC 4180: a
 * cell may be wrapped in double quotes, a delimiter inside quotes is text,
 * and a doubled quote inside quotes is one literal quote.
 */
export function splitHeaderLine(line: string): { delimiter: PgtDelimiter; cells: string[] } {
  const trimmed = line.replace(/\r$/, "");
  const delimiter: PgtDelimiter = trimmed.includes("\t") ? "\t" : ",";
  return { delimiter, cells: tokenise(trimmed, delimiter) };
}

function tokenise(line: string, delimiter: PgtDelimiter): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index++;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

export interface PgtHeader {
  delimiter: PgtDelimiter;
  /** The column count of the header row. */
  columnCount: number;
  /** Per column, the field it resolves to, or null. */
  resolved: readonly (PgtField | null)[];
  /** The column indexes each field resolved to, in column order. */
  columns: Readonly<Record<PgtField, readonly number[]>>;
  /** Column indexes whose header names a sex, gender or karyotype column. */
  forbidden: readonly number[];
}

/**
 * The header rule over one header line: null unless at least three distinct
 * fields resolve. A forbidden column never resolves to a field.
 */
export function detectPgtHeader(line: string): PgtHeader | null {
  const { delimiter, cells } = splitHeaderLine(line);
  if (cells.length < PGT_DETECTION_MINIMUM_FIELDS) return null;
  const columns: Record<PgtField, number[]> = { sample: [], embryo: [], rsid: [], genotype: [], chrom: [], pos: [] };
  const forbidden: number[] = [];
  const resolved = cells.map((cell, index) => {
    if (isForbiddenHeaderCell(cell)) {
      forbidden.push(index);
      return null;
    }
    const field = resolveHeaderCell(cell);
    if (field) columns[field].push(index);
    return field;
  });
  const distinct = PGT_FIELDS.filter((field) => columns[field].length > 0).length;
  if (distinct < PGT_DETECTION_MINIMUM_FIELDS) return null;
  return { delimiter, columnCount: cells.length, resolved, columns, forbidden };
}

export interface MappingDecision {
  /** The canonical field the reader must place. */
  field: PgtField;
  /** Neutral column indexes to choose from; never a header string or a value. */
  candidates: readonly number[];
}

export interface CompleteMapping {
  complete: true;
  identifier: { field: "sample" | "embryo"; column: number };
  genotype: number;
  locus: { kind: "rsid"; column: number } | { kind: "chrom-pos"; chrom: number; pos: number };
}

export interface PendingMapping {
  complete: false;
  /** One to four decisions, in field order. */
  decisions: readonly MappingDecision[];
}

/** Null when the file cannot be mapped within four decisions. */
export type MappingPlan = CompleteMapping | PendingMapping | null;

function single(columns: readonly number[]): number | null {
  return columns.length === 1 ? columns[0] : null;
}

/**
 * The register's `minimumUsableMapping` over a detected header: a complete
 * plan when every required field resolved exactly once, otherwise the
 * decisions still needed (a duplicated field is a choice among its columns;
 * a missing field is a choice among the unresolved, permitted columns), or
 * null beyond four decisions or when no column is left to choose from.
 */
export function planMapping(header: PgtHeader): MappingPlan {
  const unresolved = header.resolved
    .map((field, index) => (field === null && !header.forbidden.includes(index) ? index : null))
    .filter((index): index is number => index !== null);
  const decisions: MappingDecision[] = [];

  const decide = (field: PgtField): number | null => {
    const columns = header.columns[field];
    if (columns.length === 1) return columns[0];
    decisions.push({ field, candidates: columns.length > 1 ? columns : unresolved });
    return null;
  };

  // The identifier: an embryo column when it is the one such column, else a
  // sample column; a decision only when neither resolved cleanly.
  let identifier: CompleteMapping["identifier"] | null = null;
  if (single(header.columns.embryo) !== null) identifier = { field: "embryo", column: header.columns.embryo[0] };
  else if (single(header.columns.sample) !== null) identifier = { field: "sample", column: header.columns.sample[0] };
  else if (header.columns.embryo.length > 1) decisions.push({ field: "embryo", candidates: header.columns.embryo });
  else if (header.columns.sample.length > 1) decisions.push({ field: "sample", candidates: header.columns.sample });
  else decisions.push({ field: "sample", candidates: unresolved });

  const genotype = decide("genotype");

  // The locus: one rsid column, else one chrom and one pos column.
  let locus: CompleteMapping["locus"] | null = null;
  const rsid = single(header.columns.rsid);
  const chrom = single(header.columns.chrom);
  const pos = single(header.columns.pos);
  if (rsid !== null) locus = { kind: "rsid", column: rsid };
  else if (chrom !== null && pos !== null) locus = { kind: "chrom-pos", chrom, pos };
  else if (header.columns.rsid.length > 1) decisions.push({ field: "rsid", candidates: header.columns.rsid });
  else if (header.columns.chrom.length > 0 || header.columns.pos.length > 0) {
    if (chrom === null) decide("chrom");
    if (pos === null) decide("pos");
  } else decisions.push({ field: "rsid", candidates: unresolved });

  if (decisions.length === 0 && identifier && genotype !== null && locus) {
    return { complete: true, identifier, genotype, locus };
  }
  if (decisions.length > MAXIMUM_MAPPING_DECISIONS) return null;
  if (decisions.some((decision) => decision.candidates.length === 0)) return null;
  return { complete: false, decisions };
}
