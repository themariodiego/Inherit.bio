import { createHash } from "node:crypto";
import { z } from "zod";
import { MIN_MARKERS, PANEL } from "../ancestry/panel";
import {
  LINEAGE_CHROM, LINEAGE_KINDS, LINEAGE_TREE_SHA256,
  lineageMarkerPositions, lineageOf, treeOf, type LineageKind,
} from "../ancestry/lineage-panel";
import { AIMS, POPS, estimateAdmixture, type AimMarker } from "../genome/admixture";
import { classify, lineageBaseFromGenotype } from "../genome/haplogroups";

const sourceSchema = z.object({
  fileId: z.uuid(), subjectId: z.uuid(), normalizedBuild: z.literal("GRCh38"), sourceRevision: z.number().int().positive().safe(),
  callEncoding: z.enum(["vcf-literal", "array-genotype"]),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/), normalizedAt: z.iso.datetime({ offset: true }),
}).strict();
const callSchema = z.object({
  file_id: z.uuid(), chrom: z.number().int().min(1).max(25), pos: z.number().int().positive().safe(),
  ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string().max(64), usable: z.boolean(),
}).strict();
export type OwnAncestrySource = z.infer<typeof sourceSchema>;
export type OwnAncestryCall = z.infer<typeof callSchema>;
export interface OwnAncestryReferencePanel {
  id: string;
  version: string;
  provenance: string;
  minimumMarkers: number;
  markers: readonly AimMarker[];
}

// The reused estimator reads bundled AIMS internally. Accepting another panel
// would falsely attribute its output, so this adapter supports exactly this one.
function markerJson(markers: readonly AimMarker[]): string {
  return JSON.stringify(markers.map(m => ({ rsid: m.rsid, chrom: m.chrom, pos38: m.pos38,
    ref: m.ref, alt: m.alt, freqs: Object.fromEntries(POPS.map(pop => [pop, m.freqs[pop]])) })));
}
const EXPECTED_MARKERS = markerJson(AIMS);
const MARKER_SHA256 = createHash("sha256").update(EXPECTED_MARKERS).digest("hex");
export const CURRENT_OWN_ANCESTRY_PANEL: OwnAncestryReferencePanel = Object.freeze({
  id: PANEL.id, version: PANEL.version, provenance: PANEL.provenance, minimumMarkers: MIN_MARKERS,
  markers: Object.freeze(AIMS.map(marker => Object.freeze({ ...marker, freqs: Object.freeze({ ...marker.freqs }) }))),
});

type PositionState = "called" | "missing" | "noCall" | "filtered" | "conflicting" | "unsupported";
const countSchema = z.number().int().min(0).max(AIMS.length);
const shareSchema = z.number().min(0).max(1);
/** Everything both revisions agree on. Only `lineages` ever differed. */
const sharedShape = {
  source: sourceSchema,
  panel: z.object({ id: z.literal(PANEL.id), version: z.literal(PANEL.version), provenance: z.literal(PANEL.provenance),
    markerSha256: z.literal(MARKER_SHA256), markerCount: z.literal(AIMS.length), minimumMarkers: z.literal(MIN_MARKERS) }).strict(),
  admixture: z.object({
    kind: z.literal("admixture"), result: z.object({
      proportions: z.object({ AFR: shareSchema, AMR: shareSchema, EAS: shareSchema, EUR: shareSchema, SAS: shareSchema }).strict(),
      markersUsed: countSchema, note: z.string().min(1).max(4096),
    }).strict(), support_note: z.string().min(1).max(4096), model_id: z.literal(PANEL.id), model_version: z.literal(PANEL.version),
    coverage: shareSchema, result_state: z.enum(["available", "partial", "not_covered"]),
    basis: z.literal("modelled"), range: z.object({ unavailable: z.literal(true) }).strict(), resolution: z.literal("five-broad-regions"),
  }).strict(),
  panelPositions: z.object({ called: countSchema, missing: countSchema, noCall: countSchema,
    filtered: countSchema, conflicting: countSchema, unsupported: countSchema }).strict(),
} as const;

/** The admixture half, identical across revisions. */
function checkShared(value: z.infer<z.ZodObject<typeof sharedShape>>): boolean {
  const used = value.admixture.result.markersUsed;
  return Object.values(value.panelPositions).reduce((a, b) => a + b, 0) === AIMS.length
    && value.panelPositions.called === used && value.admixture.coverage === used / AIMS.length
    && value.admixture.result_state === (used === 0 ? "not_covered" : used < MIN_MARKERS ? "partial" : "available")
    && value.admixture.support_note === value.admixture.result.note
    && Math.abs(Object.values(value.admixture.result.proportions).reduce((a, b) => a + b, 0) - 1) <= 0.000001;
}

/** Revision 1: lineages were never computed, only counted — and the count was
 * always zero, because the read asked for autosomal markers alone. Kept
 * readable, never written again: content captured under it is a real result
 * whose admixture half is still exactly what it was. */
export const ownAncestryContentV1Schema = z.object({
  schemaVersion: z.literal(1), computationRevision: z.literal("own-ancestry-content-v1"), ...sharedShape,
  lineages: z.array(z.object({ kind: z.enum(LINEAGE_KINDS), state: z.literal("unavailable"),
    reason: z.enum(["no_supplied_positions", "lineage_interpretation_not_supported"]),
    observedPositions: z.number().int().nonnegative().safe(),
  }).strict()).length(2),
}).strict().superRefine((value, ctx) => {
  if (!checkShared(value)
    || value.lineages[0].kind !== "mtdna" || value.lineages[1].kind !== "ydna"
    || value.lineages.some(lineage => (lineage.observedPositions === 0) !== (lineage.reason === "no_supplied_positions"))) {
    ctx.addIssue({ code: "custom", message: "Inconsistent ancestry content" });
  }
});

const haplogroupCallSchema = z.object({
  haplogroup: z.string().min(1).max(64), path: z.array(z.string().min(1).max(64)).min(1).max(32),
  matched: z.number().int().nonnegative().safe(), tested: z.number().int().positive().safe(),
  support: z.enum(["strong", "partial", "insufficient"]), note: z.string().min(1).max(4096),
}).strict();

/** `call` and `reason` are always present and nullable rather than optional,
 * so every stored lineage has the same key set whichever state it is in. */
const lineageV2Schema = z.object({
  kind: z.enum(LINEAGE_KINDS), state: z.enum(["available", "unavailable"]),
  tree: z.object({ id: z.string().min(1).max(64), version: z.string().min(1).max(128),
    sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  markerPositions: z.number().int().positive().safe(),
  observedPositions: z.number().int().nonnegative().safe(),
  readablePositions: z.number().int().nonnegative().safe(),
  call: haplogroupCallSchema.nullable(),
  reason: z.enum(["no_supplied_positions", "no_readable_genotypes", "no_branch_matched"]).nullable(),
}).strict();

/** Revision 2 reads the lineage markers and classifies them. */
export const ownAncestryContentV2Schema = z.object({
  schemaVersion: z.literal(2), computationRevision: z.literal("own-ancestry-content-v2"), ...sharedShape,
  lineages: z.array(lineageV2Schema).length(2),
}).strict().superRefine((value, ctx) => {
  const lineageOk = value.lineages.every((lineage, index) => {
    const kind = LINEAGE_KINDS[index];
    return lineage.kind === kind
      && lineage.tree.id === treeOf(kind).id && lineage.tree.version === treeOf(kind).version
      && lineage.tree.sha256 === LINEAGE_TREE_SHA256[kind]
      && lineage.markerPositions === lineageMarkerPositions(kind).length
      && lineage.readablePositions <= lineage.observedPositions
      && lineage.observedPositions <= lineage.markerPositions
      && (lineage.state === "available"
        ? lineage.call !== null && lineage.reason === null && lineage.readablePositions > 0
        : lineage.call === null && lineage.reason === (lineage.observedPositions === 0 ? "no_supplied_positions"
          : lineage.readablePositions === 0 ? "no_readable_genotypes" : "no_branch_matched"));
  });
  if (!checkShared(value) || !lineageOk) ctx.addIssue({ code: "custom", message: "Inconsistent ancestry content" });
});

/** What a reader accepts. What a writer produces is always the latest. */
export const ownAncestryContentSchema = z.union([ownAncestryContentV2Schema, ownAncestryContentV1Schema]);
export type OwnAncestryContent = z.infer<typeof ownAncestryContentSchema>;
export type OwnAncestryContentV2 = z.infer<typeof ownAncestryContentV2Schema>;

function normalizedDiploid(value: string): string | null {
  if (!/^[ACGT](?:[/|]?[ACGT])$/.test(value)) return null;
  return value.replace(/[/|]/g, "").split("").sort().join("/");
}
function positionCall(rows: readonly OwnAncestryCall[], marker: AimMarker, encoding: OwnAncestrySource["callEncoding"]): { state: PositionState; genotype: string | null } {
  if (!rows.length) return { state: "missing", genotype: null };
  const calls = new Set(rows.map(row => normalizedDiploid(row.genotype)).filter(value => value !== null));
  if (calls.size > 1) return { state: "conflicting", genotype: null };
  if (rows.some(row => row.genotype === "--" || row.genotype === "./." || row.genotype === "."))
    return { state: "noCall", genotype: null };
  if (rows.some(row => !row.usable)) return { state: "filtered", genotype: null };
  if (rows.some(row => {
    const genotype = normalizedDiploid(row.genotype);
    if (!genotype) return true;
    // Array observations can lack REF/ALT. When present, literal SNP alleles
    // must agree with the observed genotype; symbolic/range rows are not calls.
    if ((row.ref !== null && !/^[ACGT]$/.test(row.ref)) || (row.alt !== null && !/^[ACGT]$/.test(row.alt))) return true;
    if (row.ref !== null && row.alt !== null && genotype.split("/").some(a => a !== row.ref && a !== row.alt)) return true;
    // Literal VCF alleles are already on the normalized forward reference.
    // A third allele must not enter the estimator's legacy array complement
    // fallback and be mistaken for a panel allele at this same position.
    return encoding === "vcf-literal" && (row.ref !== marker.ref
      || genotype.split("/").some(a => a !== marker.ref && a !== marker.alt));
  })) return { state: "unsupported", genotype: null };
  return { state: "called", genotype: [...calls][0] ?? null };
}

/** Pure content computation, NOT an authorization or persistence boundary.
 * The caller must supply the complete checked source-call set, resolve live
 * ancestry consent, and recheck exact source/grant authority before publication.
 * This function never infers omitted reference calls, merges files, or grants
 * lineage authority. GRCh38 normalization is a prerequisite of its input;
 * callEncoding must derive from the same checked source file type. */
export function computeOwnAncestryContent(input: {
  source: OwnAncestrySource; calls: readonly OwnAncestryCall[]; panel: OwnAncestryReferencePanel;
  /** Rows read at the lineage trees' own defining positions, and nowhere else.
   * Kept separate from `calls` so the admixture accounting cannot be moved by
   * them: the panel tally below is proved against the AIMs alone. */
  lineageCalls?: readonly OwnAncestryCall[];
  // Always the latest revision. The union is what a READER accepts; a writer
  // has no reason to produce anything but the newest, and saying so here keeps
  // callers from having to narrow a revision this function never emits.
}): OwnAncestryContentV2 {
  const parsedSource = sourceSchema.safeParse(input.source);
  const parsedCalls = z.array(callSchema).safeParse(input.calls);
  const parsedLineage = z.array(callSchema).safeParse(input.lineageCalls ?? []);
  if (!parsedSource.success || !parsedCalls.success || !parsedLineage.success) throw new Error("ancestry_input_invalid");
  const source = parsedSource.data;
  const everyRow = [...parsedCalls.data, ...parsedLineage.data];
  if (everyRow.some(row => row.file_id !== source.fileId)) throw new Error("ancestry_source_mismatch");
  // Encoding comes from the checked source file type, never guessed from a
  // genotype. Array parsers intentionally retain NULL REF/ALT; VCF does not.
  if (everyRow.some(row => source.callEncoding === "vcf-literal"
    ? row.ref === null || row.alt === null : row.ref !== null || row.alt !== null))
    throw new Error("ancestry_call_encoding_mismatch");
  // A lineage row is only ever read at a defining-marker position of its own
  // tree. Anything else is a read this result cannot use, so it is refused
  // rather than counted or quietly dropped.
  const lineagePositions = new Map<LineageKind, ReadonlySet<number>>(
    LINEAGE_KINDS.map(kind => [kind, new Set(lineageMarkerPositions(kind))]));
  const kindOfChrom = new Map<number, LineageKind>(LINEAGE_KINDS.map(kind => [LINEAGE_CHROM[kind], kind]));
  if (parsedLineage.data.some(row => {
    const kind = kindOfChrom.get(row.chrom);
    return kind === undefined || !lineagePositions.get(kind)!.has(row.pos);
  })) throw new Error("ancestry_lineage_locus_unexpected");
  const panel = input.panel;
  try {
    if (!panel || panel.id !== PANEL.id || panel.version !== PANEL.version || panel.provenance !== PANEL.provenance
      || panel.minimumMarkers !== MIN_MARKERS || markerJson(panel.markers) !== EXPECTED_MARKERS
      || markerJson(AIMS) !== EXPECTED_MARKERS) throw new Error("ancestry_panel_mismatch");
  } catch { throw new Error("ancestry_panel_mismatch"); }
  const byPosition = new Map<string, OwnAncestryCall[]>();
  for (const row of parsedCalls.data) {
    const key = `${row.chrom}:${row.pos}`;
    const group = byPosition.get(key) ?? [];
    group.push(row); byPosition.set(key, group);
  }
  const panelPositions: Record<PositionState, number> = { called: 0, missing: 0, noCall: 0, filtered: 0, conflicting: 0, unsupported: 0 };
  const genotypes = new Map<string, string>();
  for (const marker of panel.markers) {
    const key = `${marker.chrom}:${marker.pos38}`;
    const call = positionCall(byPosition.get(key) ?? [], marker, source.callEncoding);
    panelPositions[call.state]++;
    if (call.genotype !== null) genotypes.set(key, call.genotype);
  }
  const result = estimateAdmixture((chrom, pos) => genotypes.get(`${chrom}:${pos}`) ?? null);
  // The existing estimator owns strand/panel-allele compatibility. Genotypes it
  // cannot use are unsupported positions, never extra coverage or reference.
  panelPositions.unsupported += panelPositions.called - result.markersUsed;
  panelPositions.called = result.markersUsed;
  return {
    schemaVersion: 2, computationRevision: "own-ancestry-content-v2", source,
    panel: { id: panel.id, version: panel.version, provenance: panel.provenance, markerSha256: MARKER_SHA256,
      markerCount: panel.markers.length, minimumMarkers: panel.minimumMarkers },
    admixture: { kind: "admixture", result, support_note: result.note, model_id: panel.id, model_version: panel.version,
      coverage: result.markersUsed / panel.markers.length,
      result_state: result.markersUsed === 0 ? "not_covered" : result.markersUsed < panel.minimumMarkers ? "partial" : "available",
      basis: "modelled", range: { unavailable: true }, resolution: "five-broad-regions" },
    panelPositions,
    lineages: LINEAGE_KINDS.map(kind => computeLineage(kind, parsedLineage.data)),
  };
}

/**
 * One lineage, from the rows read at its own tree's defining positions.
 *
 * The three unavailable reasons are distinct on purpose, because they are
 * three different facts about a person's file and only one of them is about
 * the file lacking data. `no_supplied_positions` means the source carried
 * nothing at these positions. `no_readable_genotypes` means it did, and none
 * could be read as one base — which is what happens to a file whose haploid
 * chromosomes are encoded in a form the preparation does not decode, and
 * saying "no positions" there would be false. `no_branch_matched` means the
 * bases were read and no branch of the shipped tree was entered by them.
 *
 * Nothing here fills a gap. An absent position is absent; it is never read as
 * carrying the ancestral allele, which would enter branches on missing data.
 */
function computeLineage(kind: LineageKind, rows: readonly OwnAncestryCall[]) {
  const chrom = LINEAGE_CHROM[kind];
  const mine = rows.filter(row => row.chrom === chrom);
  const bases = new Map<number, string>();
  for (const row of mine) {
    if (!row.usable) continue;
    const base = lineageBaseFromGenotype(row.genotype);
    if (base === null) continue;
    const seen = bases.get(row.pos);
    // Two rows disagreeing at one position is not a call at that position.
    if (seen !== undefined && seen !== base) { bases.set(row.pos, ""); continue; }
    if (seen === undefined) bases.set(row.pos, base);
  }
  for (const [pos, base] of bases) if (base === "") bases.delete(pos);

  const observedPositions = new Set(mine.map(row => row.pos)).size;
  const readablePositions = bases.size;
  const tree = treeOf(kind);
  const shared = {
    kind, tree: { id: tree.id, version: tree.version, sha256: LINEAGE_TREE_SHA256[kind] },
    markerPositions: lineageMarkerPositions(kind).length, observedPositions, readablePositions,
  } as const;

  if (readablePositions === 0) {
    const reason = observedPositions === 0 ? ("no_supplied_positions" as const) : ("no_readable_genotypes" as const);
    return { ...shared, state: "unavailable" as const, call: null, reason };
  }
  const call = classify(lineageOf(kind), (atChrom, pos) => atChrom === chrom ? bases.get(pos) ?? null : null);
  if (call.haplogroup === null) {
    return { ...shared, state: "unavailable" as const, call: null, reason: "no_branch_matched" as const };
  }
  return { ...shared, state: "available" as const, reason: null,
    call: { haplogroup: call.haplogroup, path: call.path, matched: call.matched,
      tested: call.tested, support: call.support, note: call.note } };
}
