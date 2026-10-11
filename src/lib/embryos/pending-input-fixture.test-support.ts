import type { PendingEmbryoInput } from "./pending-input";

export const untouchedPending = (): PendingEmbryoInput => ({
  version: 1, accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cohortId: "0c000000-0000-4000-8000-000000000001", embryoId: "ec000000-0000-4000-8000-000000000001",
  subjectId: "5b000000-0000-4000-8000-000000000001", cohortStatus: "upload_pending", embryoStatus: "pending",
  subjectLifecycle: "quarantined", ingestRevision: 1, lifecycleRevision: 1, publicationRevision: null,
  snapshotAt: "2026-10-11T12:00:00+00:00", fileCount: 0, qcCount: 0, chunkCount: 0, fragmentCount: 0,
  workCount: 0, activeWorkCount: 0, sessions: [{ id: "15000000-0000-4000-8000-000000000001",
    ingestRevision: 1, lifecycleRevision: 1, status: "open", acceptedBytes: 0, acceptedChunks: 0,
    acceptedRecords: 0, expectedNextSequence: 0, completedAt: null, workerJobId: null,
    expiresAt: "2026-10-12T12:00:00+00:00" }],
});
