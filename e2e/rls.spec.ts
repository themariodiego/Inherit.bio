import { expect, test } from "@playwright/test";
import {
  ANON_KEY,
  SUPABASE_URL,
  adminClient,
  anonClient,
  createConfirmedUser,
} from "./helpers";

// A12 — RLS proof against the REAL PostgREST and Storage APIs: user A tries
// to read user B's data directly (no app in the way); anonymous is denied
// everywhere private. Victim data is planted with the service role.

const A = { email: "rls-a@e2e.local", password: "e2e-password-a" };
const B = { email: "rls-b@e2e.local", password: "e2e-password-b" };

let bId: string;
let bFileId: string;
let bSubjectId: string;
const bObjectPath = () => `${bId}/rls-test/victim.txt`;

test.beforeAll(async () => {
  await createConfirmedUser(A.email, A.password);
  bId = await createConfirmedUser(B.email, B.password);

  const admin = adminClient();
  const { data: subject, error: subjectError } = await admin
    .from("subjects")
    .select("id")
    .eq("subject_account_id", bId)
    .eq("subject_class", "self")
    .single();
  if (subjectError || !subject) {
    throw new Error(`plant subject: ${subjectError?.message}`);
  }
  bSubjectId = subject.id;
  await admin.from("user_variants").delete().eq("user_id", bId);
  await admin.from("chats").delete().eq("user_id", bId);
  await admin.from("consent_grants").delete().eq("user_id", bId);
  await admin.from("genome_files").delete().eq("user_id", bId);
  const { data: file, error } = await admin
    .from("genome_files")
    .insert({
      user_id: bId,
      subject_id: bSubjectId,
      bucket_path: bObjectPath(),
      original_name: "victim.txt",
      file_type: "vcf",
      tier: 1,
      size_bytes: 10,
      status: "annotated",
    })
    .select("id")
    .single();
  if (error || !file) throw new Error(`plant file: ${error?.message}`);
  bFileId = file.id;

  await admin.from("user_variants").insert({
    user_id: bId,
    file_id: bFileId,
    subject_id: bSubjectId,
    rsid: 762551,
    chrom: 15,
    pos: 74749576,
    ref: "A",
    alt: "C",
    genotype: "A/C",
  });
  await admin.from("chats").insert({
    user_id: bId,
    subject_id: bSubjectId,
    scope_kind: "self",
    lifecycle_revision: 1,
    provider_classification: "local",
    runtime_attestation_revision: 1,
    model_recipient_revision: 1,
    authorization_fingerprint: "a".repeat(64),
    title: "victim chat",
  });
  await admin.from("consent_grants").insert({
    user_id: bId,
    provider_key: "anthropic",
    data_classes: ["x"],
  });
  await admin.storage
    .from("genomes")
    .upload(bObjectPath(), new Blob(["victim data"]), { upsert: true });
});

async function clientAs(email: string, password: string) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return c;
}

test("cross-user reads return zero rows on every user table", async () => {
  const a = await clientAs(A.email, A.password);
  for (const table of [
    "genome_files",
    "user_variants",
    "chats",
    "chat_messages",
    "consent_grants",
    "ancestry_results",
    "user_prs",
    "llm_settings",
    "profiles",
    // Embryo tables are service-role only: a signed-in account gets a
    // privilege error, never a row, even for its own cohorts.
    "embryo_cohort_drafts",
    "embryo_cohorts",
    "embryos",
    "future_person_record_key_hashes",
    "embryo_operation_nonces",
  ]) {
    const { data, error } = await a.from(table).select("*").limit(10);
    if (error) {
      expect(error.code, `${table} hard denial must be a privilege error`).toBe("42501");
      continue;
    }
    const foreign = (data ?? []).filter(
      (row) =>
        ("user_id" in row && row.user_id === bId) ||
        ("id" in row && row.id === bId && table === "profiles"),
    );
    expect(foreign, `${table} must not expose user B's rows`).toHaveLength(0);
  }
});

test("filtering explicitly for the victim's ids still returns nothing", async () => {
  const a = await clientAs(A.email, A.password);
  const { data: v } = await a
    .from("user_variants")
    .select("*")
    .eq("user_id", bId);
  expect(v ?? []).toHaveLength(0);
  const { data: f } = await a
    .from("genome_files")
    .select("*")
    .eq("id", bFileId);
  expect(f ?? []).toHaveLength(0);
});

test("cross-user writes are rejected or ineffective", async () => {
  const a = await clientAs(A.email, A.password);

  // Forged insert into B's account must fail the WITH CHECK.
  const { error: insErr } = await a.from("user_variants").insert({
    user_id: bId,
    file_id: bFileId,
    chrom: 1,
    pos: 1,
    genotype: "A/A",
  });
  expect(insErr, "forged insert must be rejected").not.toBeNull();

  // Cross-user update/delete match zero rows.
  await a.from("chats").update({ title: "pwned" }).eq("user_id", bId);
  await a.from("genome_files").delete().eq("id", bFileId);
  const admin = adminClient();
  const { data: chat } = await admin
    .from("chats")
    .select("title")
    .eq("user_id", bId)
    .single();
  expect(chat?.title).toBe("victim chat");
  const { data: fileStill } = await admin
    .from("genome_files")
    .select("id")
    .eq("id", bFileId)
    .single();
  expect(fileStill?.id).toBe(bFileId);
});

test("cross-user storage reads are denied", async () => {
  const a = await clientAs(A.email, A.password);
  const { data, error } = await a.storage
    .from("genomes")
    .download(bObjectPath());
  expect(data).toBeNull();
  expect(error).not.toBeNull();

  const { data: signed } = await a.storage
    .from("genomes")
    .createSignedUrl(bObjectPath(), 60);
  expect(signed?.signedUrl ?? null).toBeNull();

  const { data: listing } = await a.storage.from("genomes").list(bId);
  expect(listing ?? []).toHaveLength(0);
});

test("anonymous is denied on every private table and the storage object", async () => {
  const anon = anonClient(); // never signed in
  for (const table of [
    "genome_files",
    "user_variants",
    "chats",
    "chat_messages",
    "consent_grants",
    "ancestry_results",
    "user_prs",
    "llm_settings",
    "profiles",
    "embryo_cohorts",
    "embryos",
    "embryo_operation_nonces",
  ]) {
    const { data } = await anon.from(table).select("*").limit(10);
    expect(data ?? [], `${table} must be empty for anon`).toHaveLength(0);
  }

  // llm_keys has no grants at all: hard permission error even for empty select.
  const { error: keysErr } = await anon.from("llm_keys").select("user_id");
  expect(keysErr).not.toBeNull();

  // Raw REST probe for the storage object.
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/genomes/${bObjectPath()}`,
    { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } },
  );
  expect(res.status).toBeGreaterThanOrEqual(400);
});

test("authenticated user cannot read llm_keys at all", async () => {
  const a = await clientAs(A.email, A.password);
  const { error } = await a.from("llm_keys").select("user_id");
  expect(error).not.toBeNull();
});
