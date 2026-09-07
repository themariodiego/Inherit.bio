import { createHash } from "node:crypto";
import { z } from "zod";
import { MIN_MARKERS, PANEL } from "../ancestry/panel";
import { AIMS, POPS, estimateAdmixture, type AimMarker } from "../genome/admixture";

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
/** Closed captured content; validates provenance and coverage without consulting
 * later scientific metadata or interpreting omitted source positions. */
export const ownAncestryContentSchema = z.object({
  schemaVersion: z.literal(1), computationRevision: z.literal("own-ancestry-content-v1"), source: sourceSchema,
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
  lineages: z.array(z.object({ kind: z.enum(["mtdna", "ydna"]), state: z.literal("unavailable"),
    reason: z.enum(["no_supplied_positions", "lineage_interpretation_not_supported"]),
    observedPositions: z.number().int().nonnegative().safe(),
  }).strict()).length(2),
}).strict().superRefine((value, ctx) => {
  const used = value.admixture.result.markersUsed;
  if (Object.values(value.panelPositions).reduce((a, b) => a + b, 0) !== AIMS.length
    || value.panelPositions.called !== used || value.admixture.coverage !== used / AIMS.length
    || value.admixture.result_state !== (used === 0 ? "not_covered" : used < MIN_MARKERS ? "partial" : "available")
    || value.admixture.support_note !== value.admixture.result.note
    || Math.abs(Object.values(value.admixture.result.proportions).reduce((a, b) => a + b, 0) - 1) > 0.000001
    || value.lineages[0].kind !== "mtdna" || value.lineages[1].kind !== "ydna"
    || value.lineages.some(lineage => (lineage.observedPositions === 0) !== (lineage.reason === "no_supplied_positions"))) {
    ctx.addIssue({ code: "custom", message: "Inconsistent ancestry content" });
  }
});
export type OwnAncestryContent = z.infer<typeof ownAncestryContentSchema>;

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
}): OwnAncestryContent {
  const parsedSource = sourceSchema.safeParse(input.source);
  const parsedCalls = z.array(callSchema).safeParse(input.calls);
  if (!parsedSource.success || !parsedCalls.success) throw new Error("ancestry_input_invalid");
  const source = parsedSource.data;
  if (parsedCalls.data.some(row => row.file_id !== source.fileId)) throw new Error("ancestry_source_mismatch");
  // Encoding comes from the checked source file type, never guessed from a
  // genotype. Array parsers intentionally retain NULL REF/ALT; VCF does not.
  if (parsedCalls.data.some(row => source.callEncoding === "vcf-literal"
    ? row.ref === null || row.alt === null : row.ref !== null || row.alt !== null))
    throw new Error("ancestry_call_encoding_mismatch");
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
  const observedPositions = (chrom: number) => new Set(parsedCalls.data.filter(row => row.chrom === chrom).map(row => row.pos)).size;
  return {
    schemaVersion: 1, computationRevision: "own-ancestry-content-v1", source,
    panel: { id: panel.id, version: panel.version, provenance: panel.provenance, markerSha256: MARKER_SHA256,
      markerCount: panel.markers.length, minimumMarkers: panel.minimumMarkers },
    admixture: { kind: "admixture", result, support_note: result.note, model_id: panel.id, model_version: panel.version,
      coverage: result.markersUsed / panel.markers.length,
      result_state: result.markersUsed === 0 ? "not_covered" : result.markersUsed < panel.minimumMarkers ? "partial" : "available",
      basis: "modelled", range: { unavailable: true }, resolution: "five-broad-regions" },
    panelPositions,
    lineages: ([{ kind: "mtdna", chrom: 25 }, { kind: "ydna", chrom: 24 }] as const).map(({ kind, chrom }) => {
      const count = observedPositions(chrom);
      return { kind, state: "unavailable", reason: count ? "lineage_interpretation_not_supported" : "no_supplied_positions", observedPositions: count };
    }),
  };
}
