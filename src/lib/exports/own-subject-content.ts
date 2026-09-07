import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { serializePrsCoverage } from "../genome/prs-output";

const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().positive().safe();
export const ownExportSnapshotSchema = z.object({
  file: z.object({ id: uuid, subject_id: uuid, original_name: z.string(), file_type: z.string(), tier: z.literal(1),
    size_bytes: z.number().int().nonnegative().safe(), sha256: hash, source_sha256: hash,
    status: z.string(), build: z.string().nullable(), created_at: z.string(), variant_count: z.number().int().nonnegative().nullable(),
    bucket_path: z.string(), storage_object_id: uuid, upload_revision: revision }).strict(),
  binding: z.object({ accountId: uuid, sessionId: uuid, accountRevision: revision, authSessionRevision: revision,
    sessionRevision: revision, subjectBindingRevision: revision, lifecycleRevision: revision,
    accountBindingId: uuid, accountBindingRevision: revision, subjectPrincipalId: uuid, subjectPrincipalRevision: revision,
    accountPrincipalId: uuid, accountPrincipalRevision: revision, normalizedAt: z.string().nullable() }).strict(),
  normalized: z.boolean(),
}).strict();
export type OwnExportSnapshot = z.infer<typeof ownExportSnapshotSchema>;
type Operation = "list" | "check" | "variants" | "observed" | "reports" | "prs";
export type OwnExportRpc = (name: "own_subject_export_content_v1", args: {
  p_operation: Operation; p_account_id: string; p_session_id: string; p_file_id: string | null;
  p_snapshot: OwnExportSnapshot | null; p_offset: number;
}) => PromiseLike<{ data: unknown; error: unknown }>;
const unavailable = () => new Error("export unavailable");
const variantSchema = z.object({ rsid: z.number().nullable(), chrom: z.number(), pos: z.number(),
  ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string() }).strict();
const observationSchema = variantSchema.extend({ source_line: z.number(), source_sha256: hash,
  source_build: z.string(), source_chrom: z.number(), source_pos: z.number(), source_ref: z.string(),
  source_alt: z.string(), source_gt: z.string().nullable(), quality_state: z.enum(["pass", "unknown", "failed"]), usable: z.boolean() });
const outcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("genotyped"), genotype: z.string(), interpretation: z.string(), strandFlipped: z.boolean() }).strict(),
  z.object({ status: z.literal("unrecognized"), genotype: z.string() }).strict(),
  z.object({ status: z.literal("no-call") }).strict(), z.object({ status: z.literal("not-covered") }).strict(),
]);
const resultSchema = z.object({ purpose: z.enum(["reports.monogenic", "reports.polygenic"]), completed_at: z.string(),
  report: z.object({ slug: z.string(), covered: z.boolean(),
    variants: z.array(z.object({ rsid: z.number(), outcome: outcomeSchema }).strict()),
    conflictingRsids: z.array(z.number()) }).strict() }).strict();
const prsSchema = z.object({ pgs_id: z.string(), matched: z.number(), computed_at: z.string(), name: z.string().nullable(),
  trait: z.string().nullable(), ancestry_note: z.string().nullable(), n_variants: z.number().nullable() }).strict();

/** A content reader for the own-subject slice. This neither creates an export
 * capability nor implements the nonce/worker/chunk delivery contract. Every
 * page rechecks the exact originating session, binding and source snapshot. */
export function ownSubjectExportContent(rpc: OwnExportRpc, actor: { accountId: string; sessionId: string }, assertActive: () => void = () => {}) {
  async function call(operation: Operation, snapshot: OwnExportSnapshot | null, offset = 0) {
    assertActive();
    if (snapshot && (snapshot.binding.accountId !== actor.accountId || snapshot.binding.sessionId !== actor.sessionId)) throw unavailable();
    const response = await rpc("own_subject_export_content_v1", { p_operation: operation, p_account_id: actor.accountId,
      p_session_id: actor.sessionId, p_file_id: snapshot?.file.id ?? null, p_snapshot: snapshot, p_offset: offset });
    assertActive();
    if (response.error) throw unavailable();
    return response.data;
  }
  async function* pages<T>(operation: Operation, snapshot: OwnExportSnapshot | null, schema: z.ZodType<T>) {
    for (let offset = 0; ; ) {
      const parsed = z.array(schema).max(1000).safeParse(await call(operation, snapshot, offset));
      if (!parsed.success) throw unavailable();
      if (!parsed.data.length) return;
      yield parsed.data;
      offset += parsed.data.length;
    }
  }
  async function check(snapshot: OwnExportSnapshot) {
    const parsed = ownExportSnapshotSchema.safeParse(await call("check", snapshot));
    // PostgreSQL compares the complete jsonb snapshot; parse again at the boundary.
    if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(ownExportSnapshotSchema.parse(snapshot))) throw unavailable();
  }
  return {
    async list() {
      const files: OwnExportSnapshot[] = [];
      for await (const page of pages("list", null, ownExportSnapshotSchema)) {
        if (page.some(s => s.binding.accountId !== actor.accountId || s.binding.sessionId !== actor.sessionId)) throw unavailable();
        files.push(...page);
      }
      return files;
    }, check,
    variants: (snapshot: OwnExportSnapshot) => pages("variants", snapshot, variantSchema),
    observed: (snapshot: OwnExportSnapshot) => pages("observed", snapshot, observationSchema),
    async reports(snapshot: OwnExportSnapshot) {
      const reports = [];
      for await (const page of pages("reports", snapshot, resultSchema)) for (const row of page) {
        if (row.report.slug.startsWith("auto-e2e-")) continue;
        reports.push({ slug: row.report.slug, purpose: row.purpose, completed_at: row.completed_at,
          covered: row.report.covered, conflictingRsids: row.report.conflictingRsids,
          provenance_note: "These are the stored outcomes. Generation did not capture the catalog revision, report description, evidence level or citations.",
          variants: row.report.variants.map(({ rsid, outcome }) => ({ rsid: `rs${rsid}`,
            status: outcome.status,
            genotype: outcome.status === "genotyped" || outcome.status === "unrecognized" ? outcome.genotype : null,
            interpretation: outcome.status === "genotyped" ? outcome.interpretation : null,
            strand_flipped: outcome.status === "genotyped" ? outcome.strandFlipped : false })) });
      }
      await check(snapshot);
      return { file_id: snapshot.file.id, subject_id: snapshot.file.subject_id, original_name: snapshot.file.original_name,
        source_revision: snapshot.file.upload_revision, source_sha256: snapshot.file.sha256,
        decoded_source_sha256: snapshot.file.source_sha256, report_count: reports.length, reports };
    },
    async prs(snapshot: OwnExportSnapshot) {
      const rows = [];
      for await (const page of pages("prs", snapshot, prsSchema)) for (const row of page) {
        rows.push({ pgs_id: row.pgs_id, name: row.name, trait: row.trait, ancestry_note: row.ancestry_note,
          file_id: snapshot.file.id, computed_at: row.computed_at, ...serializePrsCoverage(row, row.n_variants) });
      }
      await check(snapshot);
      return rows;
    },
    /** Verify both complete hashes before an archive member receives any byte.
     * Storage has already materialized a Blob in the existing ZIP route. */
    async original(snapshot: OwnExportSnapshot, download: (key: string) => PromiseLike<{ data: Blob | null; error: unknown }>) {
      await check(snapshot);
      const response = await download(snapshot.file.bucket_path);
      assertActive();
      if (response.error || !response.data || response.data.size !== snapshot.file.size_bytes) throw unavailable();
      const blob = response.data;
      const raw = createHash("sha256");
      for await (const chunk of Readable.fromWeb(blob.stream() as never)) { assertActive(); raw.update(chunk); }
      if (raw.digest("hex") !== snapshot.file.sha256) throw unavailable();
      const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      const decoded = createHash("sha256");
      const source = Readable.fromWeb(blob.stream() as never);
      const stream = head[0] === 0x1f && head[1] === 0x8b ? source.pipe(createGunzip()) : source;
      try { for await (const chunk of stream) { assertActive(); decoded.update(chunk); } }
      finally { stream.destroy(); source.destroy(); }
      if (decoded.digest("hex") !== snapshot.file.source_sha256) throw unavailable();
      await check(snapshot);
      return blob;
    },
  };
}

/** Printable canonical content uses only the same captured data as JSON. */
export function renderOwnSubjectReport(report: Awaited<ReturnType<ReturnType<typeof ownSubjectExportContent>["reports"]>>["reports"][number]) {
  return [report.slug, `Purpose: ${report.purpose}`, `Completed: ${report.completed_at}`, `Covered at generation: ${report.covered ? "yes" : "no"}`, report.provenance_note,
    ...report.variants.map(v => `${v.rsid}: ${report.conflictingRsids.includes(Number(v.rsid.slice(2))) ? "conflicting source calls; no reliable genotype" : (v.genotype ?? v.status)}${v.strand_flipped ? " [opposite strand]" : ""}${v.interpretation ? ` — ${v.interpretation}` : ""}`)].join("\n");
}
