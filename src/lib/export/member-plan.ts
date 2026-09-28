import { z } from "zod";
import plan from "../../../docs/export-member-plan.json";

/**
 * The export member plan (`docs/export-member-plan.json`): every table in the
 * public and private schemas, and for each one whether the export carries it,
 * excludes it and why, or has not built it yet.
 *
 * It is checked from both ends. `supabase/tests/export_member_plan.sql` holds
 * the plan against the real catalog: set equality between the tables and the
 * plan, and for an exported table between its columns and the plan's
 * `columns` plus `withheld`. The unit tests hold the code against the plan:
 * no withheld column reaches the synchronous archive, the archive's members
 * are exactly the plan's, and the asynchronous history reader's classes and
 * columns match it.
 *
 * `withheld` means the column never leaves in any export member, whatever the
 * reason: another person's identifier, a credential fragment, or machinery.
 */

export const EXPORT_DISPOSITIONS = [
  "exported",
  "excluded-credential",
  "excluded-protected",
  "excluded-internal",
  "out-of-scope",
  "deferred",
  "reference",
] as const;

const member = z.string().regex(/^(archive|reader):[a-z0-9._/{}-]+$/);
const reason = z.string().min(20);

const exportedEntry = z.object({
  disposition: z.literal("exported"),
  reason,
  scope: z.string().min(10),
  members: z.array(member).min(1),
  columns: z.array(z.string().min(1)).min(1),
  withheld: z.array(z.string().min(1)),
}).strict();

const excludedEntry = z.object({
  disposition: z.enum(EXPORT_DISPOSITIONS).exclude(["exported", "deferred"]),
  reason,
}).strict();

/** A deferred class may already have its archive member, carrying no rows yet. */
const deferredEntry = z.object({
  disposition: z.literal("deferred"),
  reason,
  members: z.array(member).min(1).optional(),
}).strict();

const planSchema = z.object({
  version: z.literal("export-member-plan-v1"),
  universe: z.string().min(20),
  personScoped: z.string().min(20),
  dispositions: z.object(Object.fromEntries(EXPORT_DISPOSITIONS.map((name) => [name, reason])) as
    Record<(typeof EXPORT_DISPOSITIONS)[number], typeof reason>).strict(),
  objects: z.record(z.string(), z.object({ disposition: z.literal("exported"), members: z.array(member).min(1), reason }).strict()),
  tables: z.record(z.string().regex(/^(public|private)\.[a-z0-9_]+$/),
    z.discriminatedUnion("disposition", [exportedEntry, deferredEntry, excludedEntry])),
}).strict();

export type ExportMemberPlan = z.infer<typeof planSchema>;
export type ExportedTable = z.infer<typeof exportedEntry>;

export function parseExportMemberPlan(value: unknown): ExportMemberPlan {
  return planSchema.parse(value);
}

export const exportMemberPlan: ExportMemberPlan = parseExportMemberPlan(plan);

/** The exported entry for `schema.table`, or undefined when the plan does not export it. */
export function exportedTable(name: string, source: ExportMemberPlan = exportMemberPlan): ExportedTable | undefined {
  const entry = source.tables[name];
  return entry?.disposition === "exported" ? entry : undefined;
}

/** Every archive member the plan names, from its tables and its stored objects. */
export function plannedArchiveMembers(source: ExportMemberPlan = exportMemberPlan): Set<string> {
  const members = [...Object.values(source.tables), ...Object.values(source.objects)]
    .flatMap((entry) => ("members" in entry ? entry.members ?? [] : []));
  return new Set(members.filter((name) => name.startsWith("archive:")).map((name) => name.slice("archive:".length)));
}
