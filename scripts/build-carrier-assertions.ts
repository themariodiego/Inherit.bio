/**
 * The carrier assertion importer (docs/carrier-importer-design.md; owner
 * decisions of 28 September 2026 in docs/protocol/decisions.md).
 *
 * It reads three pinned public sources and writes one reviewed-reference
 * extract. No person's genome is read, and nothing here writes a database.
 *
 *   - ClinVar's monthly tab-delimited release (`variant_summary_YYYY-MM`),
 *     from NCBI's FTP archive: exact alleles, their aggregate germline
 *     classification, review status and last-evaluated date, on both builds.
 *   - ClinGen's gene-disease validity summary: the gene-disease link must be
 *     Definitive or Strong, for autosomal recessive inheritance.
 *   - NCBI reference sequence windows (E-utilities `efetch` on the RefSeq
 *     chromosome accession ClinVar names), to check each key's reference
 *     letters and list the other spellings of an insertion or deletion.
 *
 * The evidence bar is the brief's own (lines 1193 and 1452), applied here and
 * again by the production reader rule in the database: pathogenic or likely
 * pathogenic, two review stars or more, no conflicting classification, and a
 * Definitive or Strong gene-disease link. Nothing below the bar enters the
 * extract, so the reader has nothing to loosen.
 *
 * Usage:
 *   tsx scripts/build-carrier-assertions.ts --check
 *   tsx scripts/build-carrier-assertions.ts --fetch /absolute/cache/outside/the/checkout
 *   tsx scripts/build-carrier-assertions.ts --emit-sql /absolute/output/directory
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import {
  alleleShape,
  isLeftAligned,
  rightShiftedKeys,
  type AlleleKey,
  type ReferenceWindow,
} from "../src/lib/family/allele-key";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CARRIER_DIR = "data/ref/carrier";
export const CONDITIONS_FILE = `${CARRIER_DIR}/conditions.json`;
export const EXTRACT_FILE = `${CARRIER_DIR}/clinvar-assertions.json`;
export const MANIFEST_FILE = `${CARRIER_DIR}/manifest.json`;

/** The pinned ClinVar monthly release. A new release is a new extract and a new release row. */
export const CLINVAR_RELEASE = "2026-09";
export const RELEASE_ID = `clinvar-${CLINVAR_RELEASE}`;
export const CLINVAR_URL = `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/archive/variant_summary_${CLINVAR_RELEASE}.txt.gz`;
export const CLINGEN_URL = "https://search.clinicalgenome.org/kb/gene-validity/download";
export const ACMG_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=8488021&rettype=xml";
const EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/**
 * ClinVar's review statuses and their stars, from ClinVar's own table
 * (https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/). A status not
 * listed here stops the build, so a renamed status is never read as zero.
 */
export const REVIEW_STARS: Readonly<Record<string, number>> = {
  "practice guideline": 4,
  "reviewed by expert panel": 3,
  "criteria provided, multiple submitters, no conflicts": 2,
  "criteria provided, conflicting classifications": 1,
  "criteria provided, single submitter": 1,
  "no assertion criteria provided": 0,
  "no classification provided": 0,
  "no classification for the single variant": 0,
  "no classification for the individual variant": 0,
  "-": 0,
};

export const PATHOGENIC_CLASSES = ["Pathogenic", "Likely pathogenic", "Pathogenic/Likely pathogenic"] as const;
export type PathogenicClass = (typeof PATHOGENIC_CLASSES)[number];

/** Terms ClinVar appends to a germline classification that say nothing about pathogenicity. */
const NON_PATHOGENICITY_TERMS = new Set(["drug response", "other"]);

/** The bar, in one place: two stars or more. */
export const MINIMUM_STARS = 2;

const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

// ---------------------------------------------------------------------------
// The starter list
// ---------------------------------------------------------------------------

export interface StarterCondition {
  conditionId: string;
  displayName: string;
  gene: string;
  inheritanceMode: "autosomal_recessive";
  acmgTable: string;
  clingen: {
    diseaseLabel: string;
    classification: "Definitive" | "Strong";
    moi: "AR";
    classifiedOn: string;
    gcep: string;
    url: string;
  };
}

export interface ConditionsFile {
  schemaVersion: 1;
  status: string;
  conditions: StarterCondition[];
}

export function validateConditions(file: ConditionsFile): void {
  assert.equal(file.schemaVersion, 1);
  assert(file.conditions.length >= 1 && file.conditions.length <= 20, "a short list");
  const ids = new Set<string>(), genes = new Set<string>();
  for (const condition of file.conditions) {
    assert.match(condition.conditionId, /^MONDO:[0-9]{7}$/);
    assert.match(condition.gene, /^[A-Z0-9][A-Z0-9-]{0,19}$/);
    assert(!ids.has(condition.conditionId) && !genes.has(condition.gene), "one condition per gene");
    ids.add(condition.conditionId);
    genes.add(condition.gene);
    assert.equal(condition.inheritanceMode, "autosomal_recessive", "the owner's list is autosomal recessive only");
    assert(["Definitive", "Strong"].includes(condition.clingen.classification), "the brief's gene-disease bar");
    assert.equal(condition.clingen.moi, "AR");
    assert.match(condition.clingen.classifiedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(condition.clingen.url, /^https:\/\/search\.clinicalgenome\.org\/kb\/gene-validity\/CGGV:assertion_/);
    assert(condition.displayName.trim().length > 0 && condition.displayName.length <= 80);
  }
}

/**
 * The genes of the practice resource's five autosomal recessive tables
 * (Tables 1 to 5; Table 6 is X-linked and is not read), each with the table
 * it sits in, from the PMC full-text XML.
 */
export function acmgRecessiveTables(xml: string): Map<string, string> {
  const genes = new Map<string, string>();
  for (const table of xml.matchAll(/<table-wrap[^>]*id="T([1-5])"[^>]*>([\s\S]*?)<\/table-wrap>/g)) {
    for (const cell of table[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)) {
      const text = cell[1].replace(/<[^>]+>/g, "").trim();
      if (/^[A-Z][A-Z0-9]{1,9}$/.test(text) && !genes.has(text)) genes.set(text, `Table ${table[1]}`);
    }
  }
  assert(genes.size >= 90, "the five autosomal recessive tables");
  return genes;
}

// ---------------------------------------------------------------------------
// ClinGen
// ---------------------------------------------------------------------------

export interface ClinGenRow {
  gene: string;
  hgnc: string;
  disease: string;
  mondo: string;
  moi: string;
  classification: string;
  url: string;
  classifiedOn: string;
  gcep: string;
}

/** One CSV record, with RFC 4180 quoting; ClinGen quotes every field. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else field += char;
  }
  assert(!quoted, "unterminated CSV field");
  fields.push(field);
  return fields;
}

export function parseClinGenCsv(text: string): { created: string; rows: ClinGenRow[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0).map(csvFields);
  assert.equal(lines[0]?.[0], "CLINGEN GENE DISEASE VALIDITY CURATIONS");
  const created = /^FILE CREATED: (\d{4}-\d{2}-\d{2})$/.exec(lines[1]?.[0] ?? "")?.[1];
  assert(created, "ClinGen file date");
  const header = lines.find((fields) => fields[0] === "GENE SYMBOL");
  assert.deepEqual(header, ["GENE SYMBOL", "GENE ID (HGNC)", "DISEASE LABEL", "DISEASE ID (MONDO)", "MOI", "SOP",
    "CLASSIFICATION", "ONLINE REPORT", "CLASSIFICATION DATE", "GCEP"]);
  const rows: ClinGenRow[] = [];
  for (const fields of lines.slice(lines.indexOf(header!) + 1)) {
    if (fields[0].startsWith("+++")) continue;
    assert.equal(fields.length, 10);
    rows.push({ gene: fields[0], hgnc: fields[1], disease: fields[2], mondo: fields[3], moi: fields[4],
      classification: fields[6], url: fields[7], classifiedOn: fields[8].slice(0, 10), gcep: fields[9] });
  }
  return { created, rows };
}

/** Each starter condition must match the snapshot exactly: gene, MONDO, AR, the class and its date. */
export function checkConditionsAgainstClinGen(conditions: readonly StarterCondition[], rows: readonly ClinGenRow[]): void {
  for (const condition of conditions) {
    const matches = rows.filter((row) => row.gene === condition.gene && row.mondo === condition.conditionId && row.moi === "AR");
    assert.equal(matches.length, 1, `${condition.gene} ${condition.conditionId}: one autosomal recessive ClinGen curation`);
    const [row] = matches;
    assert.equal(row.classification, condition.clingen.classification, `${condition.gene}: ClinGen classification`);
    assert(["Definitive", "Strong"].includes(row.classification), `${condition.gene}: below the gene-disease bar`);
    assert.equal(row.classifiedOn, condition.clingen.classifiedOn, `${condition.gene}: ClinGen classification date`);
    assert.equal(row.url, condition.clingen.url, `${condition.gene}: ClinGen report`);
    assert.equal(row.disease, condition.clingen.diseaseLabel, `${condition.gene}: ClinGen disease label`);
  }
}

// ---------------------------------------------------------------------------
// ClinVar
// ---------------------------------------------------------------------------

export const VARIANT_SUMMARY_COLUMNS = [
  "#AlleleID", "Type", "Name", "GeneID", "GeneSymbol", "HGNC_ID", "ClinicalSignificance", "ClinSigSimple",
  "LastEvaluated", "RS# (dbSNP)", "nsv/esv (dbVar)", "RCVaccession", "PhenotypeIDS", "PhenotypeList", "Origin",
  "OriginSimple", "Assembly", "ChromosomeAccession", "Chromosome", "Start", "Stop", "ReferenceAllele",
  "AlternateAllele", "Cytogenetic", "ReviewStatus", "NumberSubmitters", "Guidelines", "TestedInGTR", "OtherIDs",
  "SubmitterCategories", "VariationID", "PositionVCF", "ReferenceAlleleVCF", "AlternateAlleleVCF",
] as const;

export interface ClinVarRow {
  alleleId: number;
  variationId: number;
  name: string;
  gene: string;
  classificationText: string;
  lastEvaluated: string | null;
  rsid: number | null;
  phenotypeIds: string;
  originSimple: string;
  assembly: string;
  accession: string;
  chrom: number | null;
  reviewStatus: string;
  pos: number | null;
  ref: string;
  alt: string;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** ClinVar writes "Mar 03, 2004"; "-" is no date. */
export function clinvarDate(value: string): string | null {
  if (value === "-" || value === "") return null;
  const match = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})$/.exec(value);
  assert(match && MONTHS[match[1]], `unreadable ClinVar date ${value}`);
  return `${match[3]}-${MONTHS[match[1]]}-${match[2]}`;
}

function chromosomeNumber(value: string): number | null {
  if (/^([1-9]|1[0-9]|2[0-2])$/.test(value)) return Number(value);
  return value === "X" ? 23 : value === "Y" ? 24 : value === "MT" ? 25 : null;
}

export function variantSummaryIndex(header: string): Map<string, number> {
  const names = header.split("\t");
  for (const column of VARIANT_SUMMARY_COLUMNS) assert(names.includes(column), `ClinVar column ${column}`);
  return new Map(names.map((name, index) => [name, index]));
}

export function parseVariantSummaryLine(index: Map<string, number>, line: string): ClinVarRow {
  const fields = line.split("\t");
  const get = (column: (typeof VARIANT_SUMMARY_COLUMNS)[number]) => fields[index.get(column)!] ?? "";
  const rs = Number(get("RS# (dbSNP)"));
  const pos = Number(get("PositionVCF"));
  return {
    alleleId: Number(get("#AlleleID")),
    variationId: Number(get("VariationID")),
    name: get("Name"),
    gene: get("GeneSymbol"),
    classificationText: get("ClinicalSignificance"),
    lastEvaluated: clinvarDate(get("LastEvaluated")),
    rsid: Number.isSafeInteger(rs) && rs > 0 ? rs : null,
    phenotypeIds: get("PhenotypeIDS"),
    originSimple: get("OriginSimple"),
    assembly: get("Assembly"),
    accession: get("ChromosomeAccession"),
    chrom: chromosomeNumber(get("Chromosome")),
    reviewStatus: get("ReviewStatus"),
    pos: Number.isSafeInteger(pos) && pos > 0 ? pos : null,
    ref: get("ReferenceAlleleVCF"),
    alt: get("AlternateAlleleVCF"),
  };
}

/** The germline pathogenicity class of a ClinVar classification text, or null when it is not pathogenic. */
export function pathogenicClass(text: string): PathogenicClass | null {
  const [first, ...rest] = text.split("; ");
  if (!(PATHOGENIC_CLASSES as readonly string[]).includes(first)) return null;
  if (rest.some((term) => !NON_PATHOGENICITY_TERMS.has(term))) return null;
  return first as PathogenicClass;
}

export function reviewStars(status: string): number {
  const stars = REVIEW_STARS[status];
  assert(stars !== undefined, `unknown ClinVar review status "${status}"`);
  return stars;
}

/** A classification with any conflicting submission is refused, whatever its label. */
export function isConflicting(row: Pick<ClinVarRow, "classificationText" | "reviewStatus">): boolean {
  return /conflicting/i.test(row.reviewStatus) || /conflicting/i.test(row.classificationText);
}

/** Whether ClinVar names this MONDO disease on the variant (PhenotypeIDS writes "MONDO:MONDO:0009061"). */
export function namesCondition(phenotypeIds: string, mondo: string): boolean {
  return phenotypeIds.split(/[,;|]/).some((id) => id === `MONDO:${mondo}`);
}

export interface Assertion {
  variationId: number;
  alleleId: number;
  conditionId: string;
  gene: string;
  name: string;
  classification: PathogenicClass;
  reviewStatus: string;
  stars: number;
  lastEvaluated: string | null;
  rsid: number | null;
  grch38: AlleleKey;
  grch38Accession: string;
  grch37: AlleleKey | null;
  grch37Accession: string | null;
  /** Other GRCh38 spellings of the same insertion or deletion, filled once reference windows are read. */
  grch38Equivalents: AlleleKey[];
}

export const EXCLUSION_REASONS = [
  "not-pathogenic",
  "not-germline",
  "below-two-stars",
  "conflicting",
  "condition-not-named",
  "no-grch38-key",
  "not-simple",
  "not-left-aligned",
  "assembly-disagreement",
  "reference-mismatch",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface ConditionCounts {
  grch38Rows: number;
  imported: number;
  excluded: Record<ExclusionReason, number>;
}

const emptyCounts = (): ConditionCounts => ({ grch38Rows: 0, imported: 0,
  excluded: Object.fromEntries(EXCLUSION_REASONS.map((reason) => [reason, 0])) as Record<ExclusionReason, number> });

/**
 * The selection, from the rows of one release, before reference windows are
 * read. A GRCh38 row is the unit; its GRCh37 row (same allele and variation)
 * rides along when it exists and is itself a simple, left-aligned key of the
 * same shape. Only the first reason a row fails is counted.
 */
export function selectAssertions(
  conditions: readonly StarterCondition[],
  rows: Iterable<ClinVarRow>,
): { assertions: Assertion[]; counts: Record<string, ConditionCounts> } {
  const byGene = new Map(conditions.map((condition) => [condition.gene, condition]));
  const counts: Record<string, ConditionCounts> = Object.fromEntries(
    conditions.map((condition) => [condition.conditionId, emptyCounts()]));
  const grch37 = new Map<string, ClinVarRow>();
  const grch38: ClinVarRow[] = [];
  for (const row of rows) {
    if (!byGene.has(row.gene)) continue;
    if (row.assembly === "GRCh37") grch37.set(`${row.alleleId}:${row.variationId}`, row);
    else if (row.assembly === "GRCh38") grch38.push(row);
  }
  const assertions: Assertion[] = [];
  for (const row of grch38) {
    const condition = byGene.get(row.gene)!;
    const count = counts[condition.conditionId];
    count.grch38Rows++;
    const exclude = (reason: ExclusionReason) => { count.excluded[reason]++; };
    const classification = pathogenicClass(row.classificationText);
    const stars = reviewStars(row.reviewStatus);
    if (classification === null) { exclude("not-pathogenic"); continue; }
    if (!["germline", "germline/somatic"].includes(row.originSimple)) { exclude("not-germline"); continue; }
    if (isConflicting(row)) { exclude("conflicting"); continue; }
    if (stars < MINIMUM_STARS) { exclude("below-two-stars"); continue; }
    if (!namesCondition(row.phenotypeIds, condition.conditionId)) { exclude("condition-not-named"); continue; }
    if (row.chrom === null || row.pos === null || !/^NC_0000\d\d\.\d+$/.test(row.accession)) { exclude("no-grch38-key"); continue; }
    if (alleleShape(row.ref, row.alt) === null) { exclude("not-simple"); continue; }
    if (!isLeftAligned(row.ref, row.alt)) { exclude("not-left-aligned"); continue; }
    const old = grch37.get(`${row.alleleId}:${row.variationId}`);
    let key37: AlleleKey | null = null;
    if (old && old.chrom !== null && old.pos !== null && /^NC_0000\d\d\.\d+$/.test(old.accession)) {
      // Both builds are ClinVar's own placements of one allele; they must be
      // the same change, spelt the same way, on the same chromosome.
      if (old.chrom !== row.chrom || alleleShape(old.ref, old.alt) !== alleleShape(row.ref, row.alt)
        || !isLeftAligned(old.ref, old.alt) || old.ref.length !== row.ref.length || old.alt.length !== row.alt.length) {
        exclude("assembly-disagreement");
        continue;
      }
      key37 = { chrom: old.chrom, pos: old.pos, ref: old.ref, alt: old.alt };
    }
    assertions.push({
      variationId: row.variationId,
      alleleId: row.alleleId,
      conditionId: condition.conditionId,
      gene: row.gene,
      name: row.name,
      classification,
      reviewStatus: row.reviewStatus,
      stars,
      lastEvaluated: row.lastEvaluated,
      rsid: row.rsid,
      grch38: { chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt },
      grch38Accession: row.accession,
      grch37: key37,
      grch37Accession: key37 ? old!.accession : null,
      grch38Equivalents: [],
    });
    count.imported++;
  }
  assertions.sort((left, right) => left.gene.localeCompare(right.gene) || left.grch38.pos - right.grch38.pos
    || left.variationId - right.variationId);
  return { assertions, counts };
}

// ---------------------------------------------------------------------------
// Reference windows
// ---------------------------------------------------------------------------

export interface WindowRequest {
  gene: string;
  build: "GRCh38" | "GRCh37";
  accession: string;
  start: number;
  end: number;
}

/** How far past a gene's outermost key a window reaches, so every repeat can be walked to its end. */
export const WINDOW_MARGIN = 1_000;

/** One window per gene and build, spanning every key of that gene with margin. */
export function windowRequests(assertions: readonly Assertion[]): WindowRequest[] {
  const windows = new Map<string, WindowRequest>();
  for (const assertion of assertions) {
    for (const [build, key, accession] of [["GRCh38", assertion.grch38, assertion.grch38Accession],
      ["GRCh37", assertion.grch37, assertion.grch37Accession]] as const) {
      if (!key || !accession) continue;
      const id = `${assertion.gene}:${build}`;
      const start = Math.max(1, key.pos - WINDOW_MARGIN), end = key.pos + key.ref.length + WINDOW_MARGIN;
      const current = windows.get(id);
      if (current) {
        assert.equal(current.accession, accession, `${id}: one chromosome accession`);
        current.start = Math.min(current.start, start);
        current.end = Math.max(current.end, end);
      } else windows.set(id, { gene: assertion.gene, build, accession, start, end });
    }
  }
  return [...windows.values()].sort((left, right) => left.gene.localeCompare(right.gene) || left.build.localeCompare(right.build));
}

export function windowUrl(request: WindowRequest): string {
  return `${EFETCH}?db=nuccore&id=${request.accession}&rettype=fasta&retmode=text&seq_start=${request.start}&seq_stop=${request.end}`;
}

/** The sequence of one FASTA record, upper-cased; it must be exactly as long as asked for. */
export function fastaSequence(text: string, request: WindowRequest): string {
  const lines = text.trim().split(/\r?\n/);
  assert(lines[0]?.startsWith(`>${request.accession}`), `FASTA header for ${request.accession}`);
  const sequence = lines.slice(1).join("").toUpperCase();
  assert.match(sequence, /^[ACGTN]+$/);
  assert.equal(sequence.length, request.end - request.start + 1, "FASTA length");
  return sequence;
}

/**
 * Checks every key against its reference window and lists the other spellings
 * of each insertion or deletion. A key whose reference letters disagree with
 * the window is removed and counted: it cannot be matched safely.
 */
export function applyReferenceWindows(
  assertions: readonly Assertion[],
  windows: ReadonlyMap<string, ReferenceWindow>,
  counts: Record<string, ConditionCounts>,
): Assertion[] {
  const kept: Assertion[] = [];
  for (const assertion of assertions) {
    const window38 = windows.get(`${assertion.gene}:GRCh38`);
    const window37 = windows.get(`${assertion.gene}:GRCh37`);
    assert(window38, `${assertion.gene}: GRCh38 window`);
    assert(window37 || !assertion.grch37, `${assertion.gene}: GRCh37 window`);
    try {
      const equivalents = rightShiftedKeys(assertion.grch38, window38);
      if (assertion.grch37 && window37) {
        const equivalents37 = rightShiftedKeys(assertion.grch37, window37);
        // The same change has the same number of spellings on both builds
        // unless the builds differ inside the repeat; either way it is kept
        // on GRCh38, and a disagreement is reported rather than guessed at.
        if (equivalents37.length !== equivalents.length) throw new Error("repeat differs between builds");
      }
      kept.push({ ...assertion, grch38Equivalents: equivalents });
    } catch {
      counts[assertion.conditionId].excluded["reference-mismatch"]++;
      counts[assertion.conditionId].imported--;
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// The committed files
// ---------------------------------------------------------------------------

export const EXTRACT_COLUMNS = [
  "variationId", "alleleId", "conditionId", "gene", "name", "classification", "reviewStatus", "stars",
  "lastEvaluated", "rsid", "grch38", "grch37", "grch38Equivalents",
] as const;

const keyTuple = (key: AlleleKey) => [key.chrom, key.pos, key.ref, key.alt] as const;

export function extractText(assertions: readonly Assertion[]): string {
  const rows = assertions.map((assertion) => JSON.stringify([
    assertion.variationId, assertion.alleleId, assertion.conditionId, assertion.gene, assertion.name,
    assertion.classification, assertion.reviewStatus, assertion.stars, assertion.lastEvaluated, assertion.rsid,
    keyTuple(assertion.grch38), assertion.grch37 ? keyTuple(assertion.grch37) : null,
    assertion.grch38Equivalents.map((key) => [key.pos, key.ref, key.alt]),
  ]));
  return `{\n  "schemaVersion": 1,\n  "release": ${JSON.stringify(RELEASE_ID)},\n  "columns": ${JSON.stringify(EXTRACT_COLUMNS)},\n`
    + `  "assertions": [\n${rows.map((row) => `    ${row}`).join(",\n")}\n  ]\n}\n`;
}

type Tuple = [number, number, string, string];
export interface ExtractFile {
  schemaVersion: 1;
  release: string;
  columns: string[];
  assertions: [number, number, string, string, string, string, string, number, string | null, number | null,
    Tuple, Tuple | null, [number, string, string][]][];
}

export function readExtract(file: ExtractFile): Assertion[] {
  assert.equal(file.schemaVersion, 1);
  assert.deepEqual(file.columns, EXTRACT_COLUMNS);
  return file.assertions.map((row) => {
    const [variationId, alleleId, conditionId, gene, name, classification, reviewStatus, stars, lastEvaluated, rsid,
      grch38, grch37, equivalents] = row;
    return {
      variationId, alleleId, conditionId, gene, name, classification: classification as PathogenicClass,
      reviewStatus, stars, lastEvaluated, rsid,
      grch38: { chrom: grch38[0], pos: grch38[1], ref: grch38[2], alt: grch38[3] },
      grch38Accession: "",
      grch37: grch37 ? { chrom: grch37[0], pos: grch37[1], ref: grch37[2], alt: grch37[3] } : null,
      grch37Accession: null,
      grch38Equivalents: equivalents.map(([pos, ref, alt]) => ({ chrom: grch38[0], pos, ref, alt })),
    };
  });
}

/** Every invariant of one extract that can be checked without the network. */
export function verifyAssertions(assertions: readonly Assertion[], conditions: readonly StarterCondition[]): void {
  const byId = new Map(conditions.map((condition) => [condition.conditionId, condition]));
  const seen = new Set<string>(), keys = new Set<string>();
  for (const assertion of assertions) {
    const condition = byId.get(assertion.conditionId);
    assert(condition, `unknown condition ${assertion.conditionId}`);
    assert.equal(assertion.gene, condition.gene);
    assert((PATHOGENIC_CLASSES as readonly string[]).includes(assertion.classification));
    assert.equal(assertion.stars, reviewStars(assertion.reviewStatus));
    assert(assertion.stars >= MINIMUM_STARS, "below the bar");
    assert(!/conflicting/i.test(assertion.reviewStatus));
    assert(assertion.lastEvaluated === null || /^\d{4}-\d{2}-\d{2}$/.test(assertion.lastEvaluated));
    assert(Number.isSafeInteger(assertion.variationId) && assertion.variationId > 0);
    assert(assertion.name.length > 0 && assertion.name.length <= 500);
    for (const key of [assertion.grch38, ...(assertion.grch37 ? [assertion.grch37] : [])]) {
      assert(Number.isInteger(key.chrom) && key.chrom >= 1 && key.chrom <= 22, "an autosome");
      assert(Number.isSafeInteger(key.pos) && key.pos > 0);
      assert(alleleShape(key.ref, key.alt) !== null && isLeftAligned(key.ref, key.alt), "simple, left-aligned");
    }
    let previous = assertion.grch38.pos;
    for (const key of assertion.grch38Equivalents) {
      assert(key.pos > previous && alleleShape(key.ref, key.alt) === alleleShape(assertion.grch38.ref, assertion.grch38.alt));
      assert.equal(key.ref.length, assertion.grch38.ref.length);
      assert.equal(key.alt.length, assertion.grch38.alt.length);
      previous = key.pos;
    }
    const id = `${assertion.variationId}:${assertion.conditionId}`;
    assert(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
    const key = `${assertion.grch38.chrom}:${assertion.grch38.pos}:${assertion.grch38.ref}:${assertion.grch38.alt}`;
    assert(!keys.has(key), `two assertions on one allele key ${key}`);
    keys.add(key);
  }
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

interface SourceRecord {
  url: string;
  retrievedAt: string;
  lastModified: string | null;
  sha256: string;
  bytes: number;
}

async function cached(cacheDirectory: string, url: string, filename: string): Promise<{ path: string; record: SourceRecord }> {
  const target = path.join(cacheDirectory, filename);
  const sidecar = `${target}.source.json`;
  try {
    const record = JSON.parse(await fs.readFile(sidecar, "utf8")) as Omit<SourceRecord, "sha256" | "bytes">;
    assert.equal(record.url, url, `${filename} was fetched from another URL`);
    const bytes = await fs.readFile(target);
    return { path: target, record: { ...record, sha256: sha(bytes), bytes: bytes.length } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000), redirect: "error" });
  assert(response.ok && response.body, `${url} answered ${response.status}`);
  const retrievedAt = new Date().toISOString();
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  const record = { url, retrievedAt, lastModified: response.headers.get("last-modified") };
  await fs.writeFile(sidecar, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
  return { path: target, record: { ...record, sha256: sha(bytes), bytes: bytes.length } };
}

async function* variantSummaryRows(file: string): AsyncGenerator<ClinVarRow> {
  const lines = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let index: Map<string, number> | null = null;
  for await (const line of lines) {
    if (index === null) { index = variantSummaryIndex(line); continue; }
    if (line.length) yield parseVariantSummaryLine(index, line);
  }
  assert(index, "empty ClinVar release");
}

async function acquire(cacheDirectory: string): Promise<void> {
  assert(path.isAbsolute(cacheDirectory), "Use an absolute cache directory outside the checkout");
  await fs.mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const cacheRoot = await fs.realpath(cacheDirectory), checkoutRoot = await fs.realpath(ROOT);
  assert(cacheRoot !== checkoutRoot && !cacheRoot.startsWith(checkoutRoot + path.sep));

  const conditionsBytes = await fs.readFile(path.join(ROOT, CONDITIONS_FILE));
  const conditionsFile = JSON.parse(conditionsBytes.toString("utf8")) as ConditionsFile;
  validateConditions(conditionsFile);

  const clingen = await cached(cacheDirectory, CLINGEN_URL, "clingen-gene-disease-summary.csv");
  const clingenText = await fs.readFile(clingen.path, "utf8");
  const clingenParsed = parseClinGenCsv(clingenText);
  checkConditionsAgainstClinGen(conditionsFile.conditions, clingenParsed.rows);

  const acmg = await cached(cacheDirectory, ACMG_URL, "acmg-practice-resource-PMC8488021.xml");
  const recessiveTables = acmgRecessiveTables(await fs.readFile(acmg.path, "utf8"));
  for (const condition of conditionsFile.conditions) {
    assert.equal(recessiveTables.get(condition.gene), condition.acmgTable, `${condition.gene}: ACMG autosomal recessive table`);
  }

  const clinvar = await cached(cacheDirectory, CLINVAR_URL, `variant_summary_${CLINVAR_RELEASE}.txt.gz`);
  const rows: ClinVarRow[] = [];
  let totalRows = 0;
  const genes = new Set(conditionsFile.conditions.map((condition) => condition.gene));
  for await (const row of variantSummaryRows(clinvar.path)) {
    totalRows++;
    if (genes.has(row.gene)) rows.push(row);
  }
  const selected = selectAssertions(conditionsFile.conditions, rows);

  const references: (SourceRecord & WindowRequest)[] = [];
  const windows = new Map<string, ReferenceWindow>();
  for (const request of windowRequests(selected.assertions)) {
    const name = `reference-${request.accession}-${request.start}-${request.end}.fasta`;
    // E-utilities asks for at most three requests a second without a key.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const fetched = await cached(cacheDirectory, windowUrl(request), name);
    windows.set(`${request.gene}:${request.build}`, { start: request.start,
      sequence: fastaSequence(await fs.readFile(fetched.path, "utf8"), request) });
    references.push({ ...fetched.record, ...request });
  }
  const assertions = applyReferenceWindows(selected.assertions, windows, selected.counts);
  verifyAssertions(assertions, conditionsFile.conditions);

  const extract = extractText(assertions);
  const manifest = {
    schemaVersion: 1,
    release: RELEASE_ID,
    generatedAt: new Date().toISOString(),
    scope: "Public reference assertions only: ClinVar's classification of exact alleles, ClinGen's gene-disease validity and NCBI reference letters. No person's genome.",
    evidenceBar: "Pathogenic or likely pathogenic (germline), ClinVar review status of two stars or more, no conflicting classification, ClinVar names the condition's MONDO disease, and ClinGen rates the gene-disease link Definitive or Strong for autosomal recessive inheritance.",
    alleleKeys: "GRCh38 is the key the reader matches; GRCh37 is ClinVar's own placement of the same allele, kept as evidence. Only single-letter changes and simple insertions or deletions that share one anchor letter are keyed, left-aligned; the other spellings of an insertion or deletion inside a repeat are listed from the reference sequence.",
    conditionsSha256: sha(conditionsBytes),
    extractSha256: sha(extract),
    assertions: assertions.length,
    sources: {
      clinvar: { ...clinvar.record, release: CLINVAR_RELEASE, rows: totalRows,
        terms: "https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/" },
      clingen: { ...clingen.record, fileCreated: clingenParsed.created, curations: clingenParsed.rows.length,
        terms: "https://clinicalgenome.org/docs/terms-of-use/ (CC0 1.0; attribution and access date requested)" },
      acmg: { ...acmg.record, pmid: "34285390", pmcid: "PMC8488021" },
      reference: references,
    },
    counts: selected.counts,
  };
  await fs.writeFile(path.join(ROOT, EXTRACT_FILE), extract);
  await fs.writeFile(path.join(ROOT, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`carrier assertions: ${assertions.length} from ${totalRows} ClinVar rows, ${conditionsFile.conditions.length} conditions`);
}

// ---------------------------------------------------------------------------
// Offline check and the guarded import statement
// ---------------------------------------------------------------------------

export interface Manifest {
  release: string;
  conditionsSha256: string;
  extractSha256: string;
  assertions: number;
  sources: {
    clinvar: SourceRecord & { release: string; rows: number };
    clingen: SourceRecord & { fileCreated: string; curations: number };
    acmg: SourceRecord;
    reference: (SourceRecord & WindowRequest)[];
  };
  counts: Record<string, ConditionCounts>;
}

export async function readCommitted(root = ROOT) {
  const conditionsBytes = await fs.readFile(path.join(root, CONDITIONS_FILE));
  const extractBytes = await fs.readFile(path.join(root, EXTRACT_FILE));
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST_FILE), "utf8")) as Manifest;
  const conditions = JSON.parse(conditionsBytes.toString("utf8")) as ConditionsFile;
  const assertions = readExtract(JSON.parse(extractBytes.toString("utf8")) as ExtractFile);
  return { conditionsBytes, extractBytes, manifest, conditions, assertions };
}

export async function verifyCommitted(root = ROOT): Promise<{ assertions: number; conditions: number }> {
  const { conditionsBytes, extractBytes, manifest, conditions, assertions } = await readCommitted(root);
  validateConditions(conditions);
  assert.equal(sha(conditionsBytes), manifest.conditionsSha256, "conditions.json differs from the manifest");
  assert.equal(sha(extractBytes), manifest.extractSha256, "the extract differs from the manifest");
  assert.equal(manifest.release, RELEASE_ID);
  assert.equal(manifest.assertions, assertions.length);
  assert.equal(manifest.sources.clinvar.url, CLINVAR_URL);
  assert.equal(manifest.sources.clingen.url, CLINGEN_URL);
  for (const source of [manifest.sources.clinvar, manifest.sources.clingen, manifest.sources.acmg, ...manifest.sources.reference]) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert(source.bytes > 0 && !Number.isNaN(Date.parse(source.retrievedAt)));
    assert.match(source.url, /^https:\/\/(ftp\.ncbi\.nlm\.nih\.gov|eutils\.ncbi\.nlm\.nih\.gov|search\.clinicalgenome\.org)\//);
  }
  verifyAssertions(assertions, conditions.conditions);
  for (const condition of conditions.conditions) {
    const counts = manifest.counts[condition.conditionId];
    assert(counts, `${condition.conditionId}: counts`);
    assert.equal(counts.imported, assertions.filter((assertion) => assertion.conditionId === condition.conditionId).length);
    assert(counts.imported > 0, `${condition.gene}: no assertion meets the bar`);
  }
  return { assertions: assertions.length, conditions: conditions.conditions.length };
}

/** The JSON the database import door takes, in its closed shape. */
export function importPayload(
  manifest: Manifest,
  conditions: readonly StarterCondition[],
  assertions: readonly Assertion[],
) {
  return {
    release: {
      releaseId: manifest.release,
      source: "clinvar",
      sourceUrl: manifest.sources.clinvar.url,
      sourceSha256: manifest.sources.clinvar.sha256,
      sourceBytes: manifest.sources.clinvar.bytes,
      sourcePublishedOn: new Date(manifest.sources.clinvar.lastModified ?? manifest.sources.clinvar.retrievedAt).toISOString().slice(0, 10),
      retrievedAt: manifest.sources.clinvar.retrievedAt,
      extractSha256: manifest.extractSha256,
      geneValidityUrl: manifest.sources.clingen.url,
      geneValiditySha256: manifest.sources.clingen.sha256,
      geneValidityCreatedOn: manifest.sources.clingen.fileCreated,
    },
    conditions: conditions.map((condition) => ({
      conditionId: condition.conditionId,
      conditionName: condition.displayName,
      geneSymbol: condition.gene,
      inheritanceMode: condition.inheritanceMode,
      geneValidityClassification: condition.clingen.classification,
      geneValidityClassifiedOn: condition.clingen.classifiedOn,
      geneValidityUrl: condition.clingen.url,
    })),
    assertions: assertions.map((assertion) => ({
      variationId: assertion.variationId,
      conditionId: assertion.conditionId,
      geneSymbol: assertion.gene,
      variantName: assertion.name,
      classification: assertion.classification,
      reviewStatus: assertion.reviewStatus,
      reviewStars: assertion.stars,
      conflict: false,
      lastEvaluated: assertion.lastEvaluated,
      grch38: [assertion.grch38.chrom, assertion.grch38.pos, assertion.grch38.ref, assertion.grch38.alt],
      grch37: assertion.grch37 ? [assertion.grch37.chrom, assertion.grch37.pos, assertion.grch37.ref, assertion.grch37.alt] : null,
      grch38Equivalents: assertion.grch38Equivalents.map((key) => [key.pos, key.ref, key.alt]),
    })),
  };
}

/**
 * The guarded import, for the integrator to run once the owner approves it:
 * one statement through the service-only door, inactive conditions only.
 * The dry run is the same block ending in a forced exception.
 */
export function importStatements(payload: ReturnType<typeof importPayload>): { commit: string; dryRun: string } {
  const json = JSON.stringify(payload);
  assert(!json.includes("$carrier$"));
  const body = (final: string) => `-- Guarded import of ${payload.release.releaseId}: ${payload.assertions.length} ClinVar assertions for ${payload.conditions.length} conditions.
-- Generated by scripts/build-carrier-assertions.ts --emit-sql from data/ref/carrier (extract ${payload.release.extractSha256}).
-- Every condition is written inactive. No person's data is read or written.
do $import$
declare receipt jsonb; active_count integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '60000', true);
  receipt := public.import_clinical_assertion_release_v1($carrier$${json}$carrier$::jsonb);
  if (receipt->>'assertions')::integer <> ${payload.assertions.length} then
    raise exception 'carrier_import_count: %', receipt;
  end if;
  select count(*) into active_count from public.carrier_conditions where active;
  raise notice 'carrier_import_receipt: % (active conditions: %)', receipt, active_count;
${final}
end
$import$;
`;
  return {
    commit: body("  -- Commit."),
    dryRun: body("  raise exception 'carrier_import_dry_run_ok: %', receipt;"),
  };
}

async function emitSql(outputDirectory: string): Promise<void> {
  assert(path.isAbsolute(outputDirectory), "Use an absolute output directory outside the checkout");
  await verifyCommitted();
  const { manifest, conditions, assertions } = await readCommitted();
  const statements = importStatements(importPayload(manifest, conditions.conditions, assertions));
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const [name, text] of [["carrier-import.sql", statements.commit], ["carrier-import-dryrun.sql", statements.dryRun]] as const) {
    await fs.writeFile(path.join(outputDirectory, name), text);
    console.log(`${name} ${Buffer.byteLength(text)} bytes sha256 ${sha(text)}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [mode, argument] = process.argv.slice(2);
  const run = mode === "--check" && argument === undefined
    ? verifyCommitted().then((result) => console.log(`carrier assertions verified: ${result.assertions} assertions, ${result.conditions} conditions`))
    : mode === "--fetch" && argument ? acquire(argument)
      : mode === "--emit-sql" && argument ? emitSql(argument)
        : Promise.reject(new Error("Usage: --check | --fetch /absolute/cache | --emit-sql /absolute/output"));
  void run.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "carrier assertion build failed");
    process.exitCode = 1;
  });
}
