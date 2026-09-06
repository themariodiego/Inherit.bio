import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { adminClient, anonClient, createConfirmedUser, JOBS_SECRET } from "./helpers";

// This exercises the production retention route and real Storage API. The
// co-parent suite covers the refusal UI. This fixture focuses on the
// cancelled-draft/queued-phase boundary with actual evidence objects.
test("jobs.retention: physically delete refused-draft evidence without deleting another draft", async ({ request }) => {
  const admin = adminClient();
  const email = `cleanup-${randomUUID()}@e2e.local`;
  const password = "synthetic-cleanup-test-password";
  const accountId = await createConfirmedUser(email, password);
  const login = await anonClient().auth.signInWithPassword({ email, password });
  expect(login.error).toBeNull();
  const sessionId = JSON.parse(Buffer.from(login.data.session!.access_token.split(".")[1], "base64url").toString()).session_id;
  async function draft() {
    const result = await admin.rpc("create_embryo_cohort_draft_v1", {
      p_account_id: accountId, p_session_id: sessionId, p_upload_situation: "own_embryos",
      p_basis_case: "anonymous_donor", p_embryo_count: 2,
      p_owner_contact_ciphertext: "\\x0102", p_owner_contact_hmac: randomBytes(32).toString("hex"),
      p_contact_ciphertexts: [], p_contact_hmacs: [],
      p_token_nonce: randomBytes(24).toString("base64url"), p_test_jurisdiction: true,
    });
    expect(result.error).toBeNull();
    return result.data[0].draft_id as string;
  }
  const target = await draft();
  const other = await draft();
  const otherObject = randomUUID();
  const targetObject = randomUUID();
  const bucket = "legal-evidence";
  const buckets = await admin.storage.listBuckets();
  expect(buckets.error).toBeNull();
  if (!buckets.data?.some(b => b.id === bucket)) {
    expect((await admin.storage.createBucket(bucket, { public: false })).error).toBeNull();
  }
  async function evidence(draftId: string, path: string) {
    const upload = await admin.storage.from(bucket).upload(path, Buffer.from("Synthetic legal evidence only"), {
      contentType: "text/plain", upsert: false,
    });
    expect(upload.error).toBeNull();
    const d = await admin.from("embryo_cohort_drafts").select("uploader_principal_id").eq("id", draftId).single();
    expect(d.error).toBeNull();
    const session = await admin.from("legal_evidence_ingest_sessions").insert({
      principal_id: d.data!.uploader_principal_id, target_kind: "cohort_draft", target_id: draftId,
      evidence_kind: "embryo-basis", session_revision: 1, state: "open",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();
    expect(session.error).toBeNull();
    expect((await admin.from("legal_evidence_fragments").insert({
      session_id: session.data!.id, fragment_ordinal: 1, object_id: upload.data!.id,
      sha256: "a".repeat(64), byte_count: 29,
    })).error).toBeNull();
    return session.data!.id as string;
  }
  const targetSession = await evidence(target, targetObject);
  const otherSession = await evidence(other, otherObject);
  const phase = await admin.from("retention_due_phases").select("retention_row_id")
    .eq("target_id", target).eq("phase_id", "embryo-cohort-draft-expiry").single();
  expect(phase.error).toBeNull();
  expect((await admin.from("embryo_cohort_drafts").update({ state: "cancelled" }).eq("id", target)).error).toBeNull();
  expect((await admin.from("legal_evidence_ingest_sessions").update({ state: "cancelled" }).eq("id", targetSession)).error).toBeNull();
  expect((await admin.from("retention_due_phases").update({
    phase_deadline: new Date(Date.now() - 1000).toISOString(),
    immutable_envelope: { draftId: target, reason: "invitation-refused" },
  }).eq("retention_row_id", phase.data!.retention_row_id)).error).toBeNull();
  expect((await admin.storage.from(bucket).download(targetObject)).error).toBeNull();
  const response = await request.post("/api/jobs/retention", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt.failed).toBe(0);
  expect(receipt.processed).toBeGreaterThanOrEqual(1);
  expect((await admin.storage.from(bucket).download(targetObject)).error).not.toBeNull();
  expect((await admin.from("embryo_cohort_drafts").select("id").eq("id", target)).data).toEqual([]);
  expect((await admin.from("legal_evidence_ingest_sessions").select("id").eq("id", targetSession)).data).toEqual([]);
  expect((await admin.from("purge_manifests").select("state").eq("retention_row_id", phase.data!.retention_row_id)).data)
    .toEqual([{ state: "complete" }]);
  expect((await admin.storage.from(bucket).download(otherObject)).error).toBeNull();
  expect((await admin.from("embryo_cohort_drafts").select("id").eq("id", other)).data).toEqual([{ id: other }]);
  expect((await admin.from("legal_evidence_ingest_sessions").select("id").eq("id", otherSession)).data)
    .toEqual([{ id: otherSession }]);
});
