import { expect, test } from "@playwright/test";
import {
  ANON_KEY,
  SUPABASE_URL,
  adminClient,
  anonClient,
  createConfirmedUser,
} from "./helpers";

// A12 / G1.6 — RLS proof against the REAL PostgREST and Storage APIs: user A
// tries to read user B's data directly (no app in the way); anonymous is denied
// everywhere private. Victim data is planted with the service role.
//
// Storage is attacked in every bucket the migrations create, not only
// `genomes`: `genomes-staging` and `generated-artifacts` carry their own
// per-account prefixes, and a policy added to one bucket says nothing about the
// others. Every attack is paired with a service-role control that proves the
// victim object exists, keeps its bytes and gains no neighbour, so "denied" is
// never confused with "absent" and a write that silently succeeded cannot pass.

const A = { email: "rls-a@e2e.local", password: "e2e-password-a" };
const B = { email: "rls-b@e2e.local", password: "e2e-password-b" };

/** Every private bucket the migrations create, with a victim object in B's prefix. */
const BUCKETS = ["genomes", "genomes-staging", "generated-artifacts"] as const;
type Bucket = (typeof BUCKETS)[number];
const victimContent = (bucket: Bucket) => `victim data in ${bucket}`;

let aId: string;
let bId: string;
let bFileId: string;
let bSubjectId: string;
const bObjectPath = () => `${bId}/rls-test/victim.txt`;
const victimFolder = (bucket: Bucket) => (bucket === "genomes" ? `${bId}/rls-test` : `${bId}/rls-${bucket}`);
const victimPath = (bucket: Bucket) => `${victimFolder(bucket)}/victim.txt`;

async function victimBytes(bucket: Bucket): Promise<string | null> {
  const { data, error } = await adminClient().storage.from(bucket).download(victimPath(bucket));
  if (error || !data) return null;
  return data.text();
}

/** Object names under a folder as the service role sees them. */
async function namesUnder(bucket: Bucket, folder: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(bucket).list(folder);
  if (error) throw new Error(`service listing of ${bucket}/${folder}: ${error.message}`);
  return (data ?? []).map((entry) => entry.name).sort();
}

test.beforeAll(async () => {
  aId = await createConfirmedUser(A.email, A.password);
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
  for (const bucket of BUCKETS) {
    // A leftover attack artefact from an earlier local run must not pass as
    // "nothing was created": clear both prefixes before planting.
    for (const folder of [victimFolder(bucket), `${aId}/rls-${bucket}`]) {
      const stale = await namesUnder(bucket, folder);
      if (stale.length) await admin.storage.from(bucket).remove(stale.map((name) => `${folder}/${name}`));
    }
    const { error: plantError } = await admin.storage
      .from(bucket)
      .upload(victimPath(bucket), new Blob([victimContent(bucket)]), { upsert: true });
    if (plantError) throw new Error(`plant ${bucket} object: ${plantError.message}`);
    // Anti-vacuity: the victim is really there before anyone attacks it.
    expect(await victimBytes(bucket), `${bucket} victim must exist before the attack`).toBe(victimContent(bucket));
  }
});

async function clientAs(email: string, password: string) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return c;
}

/** The two tables no browser role holds a privilege on: denial is 42501, never an empty page. */
const PRIVILEGE_DENIED = new Set(["chats", "chat_messages"]);

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
    if (PRIVILEGE_DENIED.has(table)) {
      // `chats_select_own` and `chat_messages_select_own` exist but no browser
      // role can reach them: the tables carry no grant, so the real behaviour
      // is a privilege error. Asserting "zero rows" here would also pass the
      // day a grant reappears and the dead policy starts deciding access.
      expect(error?.code, `${table} must deny by privilege, not by an empty policy result`).toBe("42501");
      continue;
    }
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

test("a signed-in stranger is denied every storage operation on another account's prefix in every bucket", async () => {
  const a = await clientAs(A.email, A.password);
  for (const bucket of BUCKETS) {
    const victim = victimPath(bucket);
    const store = a.storage.from(bucket);
    const why = (operation: string) => `${bucket}: ${operation} on B's prefix must be denied for A`;

    const { data: downloaded, error: downloadError } = await store.download(victim);
    expect(downloaded, why("download")).toBeNull();
    expect(downloadError, why("download")).not.toBeNull();

    const { data: signed } = await store.createSignedUrl(victim, 60);
    expect(signed?.signedUrl ?? null, why("signed URL")).toBeNull();

    expect((await store.list(bId)).data ?? [], why("listing the account prefix")).toHaveLength(0);
    expect((await store.list(victimFolder(bucket))).data ?? [], why("listing the object folder")).toHaveLength(0);

    const { error: createError } = await store.upload(`${victimFolder(bucket)}/stranger.txt`, new Blob(["planted by A"]));
    expect(createError, why("creating an object")).not.toBeNull();

    const { error: overwriteError } = await store.upload(victim, new Blob(["overwritten by A"]), { upsert: true });
    expect(overwriteError, why("overwriting the object")).not.toBeNull();

    // Storage answers a delete that RLS filtered out with an empty list rather
    // than an error, so the proof is the service-role read below, not this call.
    const { data: removed } = await store.remove([victim]);
    expect((removed ?? []).map((entry) => entry.name), why("deleting the object")).not.toContain(victim);

    const { error: moveError } = await store.move(victim, `${aId}/rls-${bucket}/stolen.txt`);
    expect(moveError, why("moving the object into A's prefix")).not.toBeNull();

    const { error: copyError } = await store.copy(victim, `${aId}/rls-${bucket}/copied.txt`);
    expect(copyError, why("copying the object into A's prefix")).not.toBeNull();

    // Controls: the victim still exists with its exact bytes, nothing joined it
    // in B's folder, and nothing landed in A's prefix.
    expect(await victimBytes(bucket), `${bucket}: victim bytes must be unchanged after the attacks`).toBe(victimContent(bucket));
    expect(await namesUnder(bucket, victimFolder(bucket)), `${bucket}: B's folder must hold only the victim`).toEqual(["victim.txt"]);
    expect(await namesUnder(bucket, `${aId}/rls-${bucket}`), `${bucket}: A's prefix must have gained nothing`).toEqual([]);
  }
});

test("anonymous is denied every storage operation in every bucket", async () => {
  const anon = anonClient(); // never signed in
  const headers = { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` };
  for (const bucket of BUCKETS) {
    const victim = victimPath(bucket);
    const object = `${SUPABASE_URL}/storage/v1/object/${bucket}/`;
    const why = (operation: string) => `${bucket}: anonymous ${operation} must be refused`;

    expect((await fetch(object + victim, { headers })).status, why("read")).toBeGreaterThanOrEqual(400);
    expect(
      (await fetch(object + `${victimFolder(bucket)}/anonymous.txt`, { method: "POST", headers, body: "planted anonymously" })).status,
      why("create"),
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await fetch(object + victim, { method: "PUT", headers: { ...headers, "x-upsert": "true" }, body: "overwritten anonymously" })).status,
      why("overwrite"),
    ).toBeGreaterThanOrEqual(400);
    expect((await fetch(object + victim, { method: "DELETE", headers })).status, why("delete")).toBeGreaterThanOrEqual(400);

    expect((await anon.storage.from(bucket).list(bId)).data ?? [], why("listing")).toHaveLength(0);
    const { data: signed } = await anon.storage.from(bucket).createSignedUrl(victim, 60);
    expect(signed?.signedUrl ?? null, why("signed URL")).toBeNull();

    expect(await victimBytes(bucket), `${bucket}: victim bytes must be unchanged after anonymous attacks`).toBe(victimContent(bucket));
    expect(await namesUnder(bucket, victimFolder(bucket)), `${bucket}: B's folder must hold only the victim`).toEqual(["victim.txt"]);
  }
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
