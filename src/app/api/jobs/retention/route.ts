import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueAccountMail } from "@/lib/mail-outbox";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const storageObject = z
  .object({
    bucketId: z.string().min(1).max(100),
    objectName: z.string().min(1).max(1_024),
    ordinal: z.number().int().positive(),
  })
  .strict();

const storageManifest = z.array(storageObject).max(10_000);

type FailureCode =
  | "storage_delete_failed"
  | "storage_commit_failed"
  | "database_purge_failed"
  | "auth_delete_failed"
  | "finalize_failed";

function authorized(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  for (const secret of [process.env.JOBS_SECRET, process.env.CRON_SECRET]) {
    if (secret && authorization === `Bearer ${secret}`) return true;
  }
  return false;
}

function requestHasSelectors(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.search.length > 0 ||
    request.headers.has("transfer-encoding") ||
    Number(request.headers.get("content-length") ?? "0") > 0
  );
}

function claimTokenHash(): string {
  return crypto
    .createHash("sha256")
    .update(crypto.randomBytes(32))
    .digest("hex");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function isMissingAuthUser(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; status?: number };
  return candidate.status === 404 || candidate.code === "user_not_found";
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (requestHasSelectors(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  let processed = 0;
  let failed = 0;

  // Independent contact expiry runs even when a mail provider is unavailable.
  const { error: terminalContactExpiryError } = await admin.rpc(
    "expire_embryo_terminal_mail_v1",
  );
  if (terminalContactExpiryError) {
    // Preserve unrelated original deadlines even if this independent queue
    // cannot be purged. The coded failure remains visible to job monitoring.
    failed++;
  }

  const { data: expiredInvitations, error: invitationExpiryError } =
    await admin.rpc("expire_due_adult_subject_invitations_v1");
  if (invitationExpiryError) {
    return NextResponse.json(
      { error: "retention_worker_unavailable" },
      { status: 503 },
    );
  }

  // Embryo cohort drafts past their 30-day deadline (E0 contract §6.9): the
  // database expires every draft that is due and shreds its contacts; this
  // route then tells each owner, whose address it reads from auth alone. A
  // draft whose owner no longer exists is expired without a notice.
  const { data: expiredDrafts, error: draftExpiryError } = await admin.rpc(
    "run_due_embryo_retention_phases_v1",
  );
  if (draftExpiryError) {
    return NextResponse.json(
      { error: "retention_worker_unavailable" },
      { status: 503 },
    );
  }
  for (const draft of expiredDrafts ?? []) {
    try {
      const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(
        draft.owner_account_id,
      );
      if (ownerError && !isMissingAuthUser(ownerError)) throw ownerError;
      if (!owner?.user?.email) continue;
      await enqueueAccountMail({
        accountId: draft.owner_account_id,
        email: owner.user.email,
        mail: { id: "embryo-draft-expired", payload: {} },
        purpose: "embryo-draft-expired",
        targetKind: "cohort_draft",
        targetId: draft.draft_id,
        semanticKey: draft.draft_id,
      });
      processed++;
    } catch {
      failed++;
    }
  }

  // The caller cannot select a row or batch size. The database serializes and
  // chooses due work, while this fixed bound limits one invocation's runtime.
  for (let index = 0; index < 5; index++) {
    const claimToken = claimTokenHash();
    const { data, error } = await admin.rpc("claim_due_account_deletion_v1", {
      p_claim_token_hash: claimToken,
      p_lease_seconds: 300,
    });
    if (error) {
      if (processed === 0 && failed === 0) {
        return NextResponse.json(
          { error: "retention_worker_unavailable" },
          { status: 503 },
        );
      }
      break;
    }

    const claim = data?.[0];
    if (!claim) break;
    let failureCode: FailureCode = "storage_delete_failed";

    try {
      if (!claim.database_already_purged) {
        const manifest = storageManifest.parse(claim.storage_objects);
        const byBucket = new Map<string, typeof manifest>();
        for (const entry of manifest) {
          const bucketEntries = byBucket.get(entry.bucketId) ?? [];
          bucketEntries.push(entry);
          byBucket.set(entry.bucketId, bucketEntries);
        }

        for (const [bucketId, entries] of byBucket) {
          for (const batch of chunks(entries, 1_000)) {
            const { error: storageError } = await admin.storage
              .from(bucketId)
              .remove(batch.map((entry) => entry.objectName));
            if (storageError) throw storageError;

            failureCode = "storage_commit_failed";
            const { error: commitError } = await admin.rpc(
              "complete_account_deletion_storage_batch_v1",
              {
                p_deletion_id: claim.deletion_id,
                p_claim_token_hash: claimToken,
                p_entries: batch.map(({ bucketId, objectName }) => ({
                  bucketId,
                  objectName,
                })),
              },
            );
            if (commitError) throw commitError;
            failureCode = "storage_delete_failed";
          }
        }

        failureCode = "storage_commit_failed";
        const { error: storageCompletionError } = await admin.rpc(
          "complete_account_deletion_storage_v1",
          {
            p_deletion_id: claim.deletion_id,
            p_claim_token_hash: claimToken,
          },
        );
        if (storageCompletionError) throw storageCompletionError;

        failureCode = "database_purge_failed";
        const { data: purgedAccountId, error: purgeError } = await admin.rpc(
          "purge_account_deletion_database_v1",
          {
            p_deletion_id: claim.deletion_id,
            p_claim_token_hash: claimToken,
          },
        );
        if (purgeError || purgedAccountId !== claim.account_id) {
          throw purgeError ?? new Error("purged_account_mismatch");
        }
      }

      failureCode = "auth_delete_failed";
      const { error: authError } = await admin.auth.admin.deleteUser(
        claim.account_id,
      );
      if (authError && !isMissingAuthUser(authError)) throw authError;

      failureCode = "finalize_failed";
      const { error: finalizeError } = await admin.rpc(
        "finalize_account_deletion_v1",
        {
          p_deletion_id: claim.deletion_id,
          p_claim_token_hash: claimToken,
        },
      );
      if (finalizeError) throw finalizeError;
      processed++;
    } catch {
      await admin.rpc("fail_account_deletion_attempt_v1", {
        p_deletion_id: claim.deletion_id,
        p_claim_token_hash: claimToken,
        p_error_code: failureCode,
      });
      failed++;
    }
  }

  const now = new Date().toISOString();
  const { count: pending } = await admin
    .from("account_deletion_requests")
    .select("id", { count: "exact", head: true })
    .or(`and(state.eq.notice_period,notice_ends_at.lte.${now}),state.eq.delete_started`);

  return NextResponse.json({
    processed,
    failed,
    pending: pending ?? 0,
    expiredInvitations: expiredInvitations ?? 0,
  });
}
