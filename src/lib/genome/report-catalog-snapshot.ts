import { z } from "zod";
import { EVIDENCE_LEVELS, ESTIMATE_KINDS, LAYERS } from "./taxonomy";
import { studyContextFindings } from "./study-context";

const text = z.string().max(100_000);
const studyEntry = z.object({ text, locator: text }).strict().nullable();
const citation = z.object({
  pmid: z.string().regex(/^\d{6,9}$/).optional(),
  doi: z.string().regex(/^10\.\d{4,9}\/\S+$/).optional(),
  label: text,
  accessedOn: z.iso.date().optional(),
  studyContext: z.object({ measured: studyEntry, population: studyEntry,
    comparison: studyEntry, limitation: studyEntry }).strict().optional(),
}).strict().refine(value => studyContextFindings(value).length === 0);

/** The exact public template selected by generation, without a mutable lookup
 * during chat/export. No defaults or transformations may rewrite its history. */
export const reportCatalogTemplateSchema = z.object({
  slug: z.string().min(1).max(500), category: z.string().min(1).max(500),
  title: text, summary: text, evidence: z.enum(EVIDENCE_LEVELS),
  variants: z.array(z.object({
    rsid: z.number().int().positive().safe(), gene: text,
    chrom: z.number().int().min(1).max(25), pos38: z.number().int().positive().safe(),
    ref: text, alt: text, interpretations: z.record(z.string(), text),
  }).strict()).max(1000),
  pgs_id: z.string().nullable(), citations: z.array(citation).max(100),
  layer: z.enum(LAYERS), estimate_kind: z.enum(ESTIMATE_KINDS).nullable(),
}).strict();

/** PostgreSQL creates templateSha256 from the exact jsonb template after
 * checking it against the locked published row at completion. */
export const reportCatalogSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  templateSha256: z.string().regex(/^[0-9a-f]{64}$/),
  template: reportCatalogTemplateSchema,
}).strict();
