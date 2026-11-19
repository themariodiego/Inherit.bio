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
  return detectPgtHeaderCells(cells, delimiter);
}

/**
 * The same header rule over cells already split from a header line: the
 * mapping route receives the bounded header copy as cells, never as a line.
 */
export function detectPgtHeaderCells(cells: readonly string[], delimiter: PgtDelimiter = ","): PgtHeader | null {
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

/** The locus a mapping plan selects: an rsID column, or a chromosome and position pair. */
export type PgtLocusKind = CompleteMapping["locus"]["kind"];

/**
 * The locus kind the plan fixes, whatever the reader then decides. A
 * decision for `rsid` keeps the rsID locus, a decision for `chrom` or `pos`
 * keeps the coordinate locus, and with no locus decision the header already
 * resolved one. The server records this one closed value; it is canonical,
 * never source text.
 */
export function planLocusKind(header: PgtHeader, plan: Exclude<MappingPlan, null>): PgtLocusKind {
  if (plan.complete) return plan.locus.kind;
  if (plan.decisions.some((decision) => decision.field === "rsid")) return "rsid";
  if (plan.decisions.some((decision) => decision.field === "chrom" || decision.field === "pos")) return "chrom-pos";
  return header.columns.rsid.length === 1 ? "rsid" : "chrom-pos";
}

/** One column the reader may place, with the fields it may hold: the register's column-oriented challenge. */
export interface MappingChallengeColumn {
  columnIndex: number;
  candidateFields: PgtField[];
}

/**
 * The plan's field decisions turned around into one entry per candidate
 * column, in column order, each naming the fields that column may hold in
 * the canonical order. Neutral indexes and canonical names only.
 */
export function mappingChallengeColumns(plan: PendingMapping): MappingChallengeColumn[] {
  const byColumn = new Map<number, Set<PgtField>>();
  for (const decision of plan.decisions) {
    for (const column of decision.candidates) {
      const fields = byColumn.get(column) ?? new Set<PgtField>();
      fields.add(decision.field);
      byColumn.set(column, fields);
    }
  }
  return [...byColumn.entries()].sort(([left], [right]) => left - right)
    .map(([columnIndex, fields]) => ({ columnIndex, candidateFields: PGT_FIELDS.filter((field) => fields.has(field)) }));
}

/** A reader's answer to one decision: this column holds this field. */
export interface MappingAnswer {
  field: PgtField;
  column: number;
}

/**
 * The complete mapping the header and the reader's answers give, or null
 * when the answers do not settle every decision of the plan exactly once,
 * name a column that was not offered for that field, or leave the header
 * still ambiguous. Each answered field takes exactly its chosen column; any
 * other column that resolved to the same field is left unused.
 */
export function applyMappingAnswers(header: PgtHeader, answers: readonly MappingAnswer[]): CompleteMapping | null {
  const plan = planMapping(header);
  if (!plan) return null;
  if (plan.complete) return answers.length === 0 ? plan : null;
  if (answers.length !== plan.decisions.length) return null;
  const used = new Set<number>();
  for (const decision of plan.decisions) {
    const answer = answers.filter((item) => item.field === decision.field);
    if (answer.length !== 1 || !decision.candidates.includes(answer[0].column) || used.has(answer[0].column)) return null;
    used.add(answer[0].column);
  }
  const resolved = [...header.resolved];
  const columns = Object.fromEntries(PGT_FIELDS.map((field) => [field, [...header.columns[field]]])) as Record<PgtField, number[]>;
  for (const { field, column } of answers) {
    for (const index of columns[field]) if (index !== column) resolved[index] = null;
    const previous = resolved[column];
    if (previous) columns[previous] = columns[previous].filter((index) => index !== column);
    columns[field] = [column];
    resolved[column] = field;
  }
  const settled = planMapping({ ...header, resolved, columns });
  if (!settled || !settled.complete) return null;
  const chosen = [settled.identifier.column, settled.genotype,
    ...(settled.locus.kind === "rsid" ? [settled.locus.column] : [settled.locus.chrom, settled.locus.pos])];
  return answers.every((answer) => chosen.includes(answer.column)) ? settled : null;
}
