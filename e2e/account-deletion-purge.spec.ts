import { expect, test } from "@playwright/test";
import path from "node:path";
import {
  adminClient,
  createConfirmedUser,
  ingestFileAs,
  JOBS_SECRET,
  signIn,
} from "./helpers";

// A13 — after the fixed notice period, the unattended worker deletes exact
// storage handles, the complete supported self-account graph, and Auth last.

const USER = { email: "purge-me@e2e.local", password: "e2e-purge-pw" };

test("due account deletion reaches a zero-residual terminal state", async ({
  page,
  request,
}) => {
  const userId = await createConfirmedUser(USER.email, USER.password);
  await signIn(page, USER.email, USER.password);
  const fileId = await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  const admin = adminClient();
  const { data: file } = await admin
    .from("genome_files")
    .select("subject_id,storage_object_id")
    .eq("id", fileId)
    .single();
  expect(file?.subject_id).toBeTruthy();
  expect(file?.storage_object_id).toBeTruthy();
  const { data: binding } = await admin
    .from("subject_account_bindings")
    .select("account_principal_id,subject_principal_id")
    .eq("account_id", userId)
    .single();
  const principalIds = [
    binding!.account_principal_id,
    binding!.subject_principal_id,
  ];

  const { data: storageObject } = await admin
    .from("genome_storage_objects")
    .select("bucket_id,object_name")
    .eq("object_id", file!.storage_object_id!)
    .single();
  expect(storageObject?.object_name).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto("/settings/data");
  await page.getByLabel(/Type/).fill("delete my genome");
  await page.getByTestId("delete-account").click();
  await expect(
    page.getByRole("heading", { name: "Account deletion scheduled" }),
  ).toBeVisible();

  const { data: deletion } = await admin
    .from("account_deletion_requests")
    .select("id")
    .eq("account_id", userId)
    .eq("state", "notice_period")
    .single();
  const { data: retention } = await admin
    .from("retention_rows")
    .select("id")
    .eq("retention_id", "account-deletion.notice-7d")
    .eq("target_id", userId)
    .single();
  expect(deletion?.id).toBeTruthy();
  expect(retention?.id).toBeTruthy();

  // Advance the immutable deadline fields together to simulate the passage of
  // eight days without weakening the production worker's due checks.
  const dueAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const requestedAt = new Date(
    new Date(dueAt).getTime() - 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  expect(
    (
      await admin
        .from("account_deletion_requests")
        .update({ requested_at: requestedAt, notice_ends_at: dueAt })
        .eq("id", deletion!.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await admin
        .from("retention_rows")
        .update({ fixed_deadline: dueAt })
        .eq("id", retention!.id)
    ).error,
  ).toBeNull();
  expect(
    (
      await admin
        .from("retention_due_phases")
        .update({ phase_deadline: dueAt })
        .eq("retention_row_id", retention!.id)
    ).error,
  ).toBeNull();

  expect((await request.get("/api/jobs/retention")).status()).toBe(405);
  expect((await request.post("/api/jobs/retention")).status()).toBe(401);
  expect(
    (
      await request.post("/api/jobs/retention?account=attacker-selected", {
        headers: { authorization: `Bearer ${JOBS_SECRET}` },
      })
    ).status(),
  ).toBe(400);

  const purge = await request.post("/api/jobs/retention", {
    headers: { authorization: `Bearer ${JOBS_SECRET}` },
  });
  expect(purge.status(), await purge.text()).toBe(200);
  expect(await purge.json()).toMatchObject({ processed: 1, failed: 0, pending: 0 });

  const { data: completed } = await admin
    .from("account_deletion_requests")
    .select("state,account_id,account_pseudonym_id,completed_at")
    .eq("id", deletion!.id)
    .single();
  expect(completed).toMatchObject({ state: "complete", account_id: null });
  expect(completed?.account_pseudonym_id).not.toBe(userId);
  expect(completed?.completed_at).toBeTruthy();

  const authLookup = await admin.auth.admin.getUserById(userId);
  expect(authLookup.data.user).toBeNull();
  expect(authLookup.error).toBeTruthy();

  for (const result of [
    await admin.from("profiles").select("id").eq("id", userId),
    await admin.from("subject_account_bindings").select("id").eq("account_id", userId),
    await admin.from("account_security_states").select("account_id").eq("account_id", userId),
    await admin.from("genome_files").select("id").eq("user_id", userId),
    await admin.from("upload_sessions").select("id").eq("account_id", userId),
    await admin.from("generated_exports").select("id").eq("account_id", userId),
    await admin
      .from("encrypted_contact_references")
      .select("id")
      .in("principal_id", principalIds),
    await admin.from("subject_principals").select("id").in("id", principalIds),
    await admin.from("subjects").select("id").eq("id", file!.subject_id!),
    await admin
      .from("genome_storage_objects")
      .select("object_id")
      .eq("object_id", file!.storage_object_id!),
  ]) {
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  }

  const missingObject = await admin.storage
    .from(storageObject!.bucket_id)
    .download(storageObject!.object_name);
  expect(missingObject.data).toBeNull();
  expect(missingObject.error).toBeTruthy();

  const { data: completedRetention } = await admin
    .from("retention_rows")
    .select("state,target_id,ended_at")
    .eq("id", retention!.id)
    .single();
  expect(completedRetention).toMatchObject({
    state: "complete",
    target_id: completed!.account_pseudonym_id,
  });
  expect(completedRetention?.ended_at).toBeTruthy();
});
