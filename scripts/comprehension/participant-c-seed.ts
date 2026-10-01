import { z } from "zod";

const seed = z.object({
  email: z.literal("participant-c@e2e.local"),
  by: z.literal("e2e/embryo-ingest-journey.spec.ts"),
  fileTypes: z.tuple([z.literal("vcf")]),
  purposes: z.tuple([z.literal("embryo.analysis")]),
  coParentEmail: z.literal("participant-c-parent@e2e.local"),
  project: z.literal("embryo-ingest"),
  runtime: z.literal("exact-disposable-ci-native-partition"),
  readiness: z.literal("real-signed-parent-upload-worker-publication-required"),
  order: z.string().min(1),
}).strict();

/** Metadata identifies the existing real journey, never grants seed authority. */
export function participantCSeed(value: unknown) {
  return z.object({ id: z.literal("participant-c"),
    files: z.tuple([z.literal("e2e/fixtures/embryo-pair-grch38.vcf")]), seed,
  }).passthrough().parse(value);
}

const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const EMBRYO_PUBLISHED_FILE_SELECT = "id,user_id,subject_id,status,file_type,sample_count,cohort_id,is_cohort_file,source_publication_state,source_publication_revision,source_binding_fingerprint,source_sha256,canonical_build,upload_revision,normalization_completed_at,normalization_source_revision,single_logical_sample_verified_at,processing_started_at,processing_finished_at,bucket_path,sha256,storage_object_id";
const publishedFile = z.object({
  id: uuid, user_id: uuid, subject_id: uuid, status: z.literal("stored"), file_type: z.literal("vcf"),
  sample_count: z.literal(1), cohort_id: z.null(), is_cohort_file: z.literal(false),
  source_publication_state: z.literal("published"), source_publication_revision: z.literal(1),
  source_binding_fingerprint: sha256, source_sha256: sha256, canonical_build: z.literal("GRCh38"),
  upload_revision: z.literal(1), normalization_completed_at: timestamp, normalization_source_revision: z.literal(1),
  single_logical_sample_verified_at: timestamp, processing_started_at: z.null(), processing_finished_at: timestamp,
  bucket_path: z.string(), sha256: z.null(), storage_object_id: z.null(),
}).strict();

/** Both native fixtures consume the actual publication contract: `stored`
 * is the file status; normalization completion is its exact current receipt. */
export function publishedEmbryoFiles(value: unknown, expected: {
  ownerId: string; publishedAt: string; subjectIds: readonly string[];
}) {
  const files = z.array(publishedFile).min(1).max(2).parse(value);
  if (new Set(expected.subjectIds).size !== expected.subjectIds.length
    || files.length !== expected.subjectIds.length || new Set(files.map(file => file.id)).size !== files.length
    || JSON.stringify(files.map(file => file.subject_id).sort()) !== JSON.stringify([...expected.subjectIds].sort())
    || files.some(file => file.user_id !== expected.ownerId || file.bucket_path !== `embryo-source/${file.id}`
      || file.source_binding_fingerprint !== file.source_sha256
      || file.normalization_completed_at !== expected.publishedAt
      || file.single_logical_sample_verified_at !== expected.publishedAt
      || file.processing_finished_at !== expected.publishedAt)) {
    throw new Error("Published embryo source or normalization receipt differs");
  }
  return files;
}
const publication = z.object({
  cohort: z.object({ id: uuid, owner_account_id: uuid, status: z.literal("active"), publication_revision: z.literal(1), uploaded_at: timestamp }).strict(),
  embryos: z.array(z.object({ id: uuid, subject_id: uuid, sample_ordinal: z.number().int().min(0).max(1), status: z.literal("qc_pass") }).strict()).length(2),
  files: z.array(publishedFile).length(2),
  proof: z.object({ jobs: z.literal(1), sessions: z.literal(1), cohorts: z.literal(1), sources: z.literal(2),
    parts: z.literal(2), allPartsCurrent: z.literal(true), scores: z.literal(0),
    ordinals: z.array(z.object({ ordinal: z.number().int().min(0).max(1), status: z.literal("qc_pass"), sources: z.literal(1), parts: z.literal(1) }).strict()).length(2),
    pendingOrdinals: z.literal(0), pendingVariants: z.literal(0) }).strict(),
}).strict();

/** A current read of the actual journey outcome, not a score or seed writer. */
export function participantCPublication(value: unknown, ownerId: string, cohortId: string) {
  const current = publication.parse(value);
  const ordinals = current.embryos.map(row => row.sample_ordinal).sort();
  const subjects = current.embryos.map(row => row.subject_id).sort();
  if (current.cohort.id !== cohortId || current.cohort.owner_account_id !== ownerId
    || new Set(current.embryos.map(row => row.id)).size !== 2 || new Set(subjects).size !== 2
    || JSON.stringify(ordinals) !== "[0,1]"
    || JSON.stringify(current.proof.ordinals.map(row => row.ordinal).sort()) !== "[0,1]"
    || JSON.stringify(current.files.map(row => row.subject_id).sort()) !== JSON.stringify(subjects)) {
    throw new Error("Participant-c publication identity differs");
  }
  publishedEmbryoFiles(current.files, { ownerId, publishedAt: current.cohort.uploaded_at, subjectIds: subjects });
  return current;
}

/** Missing storage, foreign paths or events cannot turn into a zero-action pass. */
export function taskSixTrace(raw: string | null, ceiling: number) {
  if (raw === null || ceiling !== 3) throw new Error("Task T6 action trace unavailable");
  const trace = z.array(z.object({ event: z.enum(["click", "submit"]),
    path: z.enum(["/overview", "/embryos", "/embryos/compare"]),
  }).strict()).min(1).max(ceiling).parse(JSON.parse(raw));
  return { trace, actions: trace.length };
}
