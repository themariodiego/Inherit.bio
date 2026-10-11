import { z } from "zod";
import { EMBRYO_STATUSES } from "./policy";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = count.min(1);
const session = z.object({
  id: z.uuid(), ingestRevision: revision.nullable(), lifecycleRevision: revision.nullable(),
  status: z.enum(["open", "mapping_required", "complete", "processing", "published", "failed", "abandoned", "cancelled", "sanitization_pending", "failure_pending"]),
  acceptedBytes: count, acceptedChunks: count, acceptedRecords: count, expectedNextSequence: count,
  completedAt: z.iso.datetime({ offset: true }).nullable(), workerJobId: z.uuid().nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
/** Native metadata only, from one MVCC snapshot. No DNA, cookie, handle, key,
 * nonce, authority fingerprint, worker payload, result or error leaves here. */
export const pendingEmbryoInputSchema = z.object({
  version: z.literal(1), accountId: z.uuid(), cohortId: z.uuid(), embryoId: z.uuid(), subjectId: z.uuid(),
  cohortStatus: z.enum(["upload_pending", "ingesting", "active"]), embryoStatus: z.enum(EMBRYO_STATUSES),
  subjectLifecycle: z.string().min(1), ingestRevision: revision, lifecycleRevision: revision,
  publicationRevision: revision.nullable(), snapshotAt: z.iso.datetime({ offset: true }),
  sessions: z.array(session).max(64), fileCount: count, qcCount: count,
  chunkCount: count, fragmentCount: count, workCount: count, activeWorkCount: count,
}).strict().refine(value => new Set(value.sessions.map(item => item.id)).size === value.sessions.length)
  .refine(value => value.activeWorkCount <= value.workCount);
export type PendingEmbryoInput = z.infer<typeof pendingEmbryoInputSchema>;
export const pendingEmbryoScopeSchema = z.object({
  accountId: z.uuid(), cohortId: z.uuid(), embryoId: z.uuid(), subjectId: z.uuid(),
}).strict();
export type PendingEmbryoScope = z.infer<typeof pendingEmbryoScopeSchema>;

export function parsePendingEmbryoInput(value: unknown, scope: PendingEmbryoScope): PendingEmbryoInput | null {
  const expected = pendingEmbryoScopeSchema.safeParse(scope);
  const parsed = pendingEmbryoInputSchema.safeParse(value);
  if (!expected.success || !parsed.success || (Object.keys(expected.data) as (keyof PendingEmbryoScope)[])
    .some(key => parsed.data[key] !== expected.data[key])) return null;
  return parsed.data;
}

/** Only this complete, current untouched attempt contradicts pending=work.
 * Missing/stale attempts, any reservation or historical work, and real files
 * waiting for QC remain processing. No caller may derive empty from a count
 * alone, or from an absent/failed query. */
export function isUntouchedPendingInput(value: PendingEmbryoInput): boolean {
  const parsed = pendingEmbryoInputSchema.safeParse(value);
  if (!parsed.success) return false;
  const row = parsed.data, attempt = row.sessions[0];
  return row.cohortStatus === "upload_pending" && row.embryoStatus === "pending"
    && row.subjectLifecycle === "quarantined" && row.publicationRevision === null
    && row.sessions.length === 1 && attempt.status === "open"
    && attempt.ingestRevision === row.ingestRevision && attempt.lifecycleRevision === row.lifecycleRevision
    && Date.parse(attempt.expiresAt) > Date.parse(row.snapshotAt)
    && attempt.acceptedBytes === 0 && attempt.acceptedChunks === 0 && attempt.acceptedRecords === 0
    && attempt.expectedNextSequence === 0 && attempt.completedAt === null && attempt.workerJobId === null
    && row.fileCount === 0 && row.qcCount === 0 && row.chunkCount === 0 && row.fragmentCount === 0
    && row.workCount === 0 && row.activeWorkCount === 0;
}
