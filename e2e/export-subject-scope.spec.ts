import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminClient, createConfirmedUser, findUserByEmail, signIn } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";

/**
 * G5.6, the subject-scoping half, executed rather than read.
 *
 * The route surfaced no subject anywhere: `manifest.json`'s `files[]` carried
 * id, name, type, tier, size, sha256, status, build, created_at, variant_count
 * and row_count and no `subject_id`, so an account holding another adult's or
 * a family subject's file could not say whose data each file was. The field is
 * now written and `src/app/api/export/route.test.ts` asserts it, but that is a
 * unit assertion over a mocked query — the acceptance row's own limit was that
 * nothing had executed an export.
 *
 * This runs the real route against a real upload and checks the value against
 * the subject the database actually resolved, which is the part a unit test
 * cannot do: it would assert whatever the mock was told to return.
 *
 * `e2e/deletion-export.spec.ts` stays the home for archive completeness — the
 * originals, the variant CSV and the no-fee path. This is the separate
 * question of whose data the archive says each file is.
 */
const RUN_ID = randomUUID();
const USER = { email: `export-scope-${RUN_ID}@e2e.local`, password: "e2e-export-scope-pw" };
const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
});

test("every exported file names the subject the database resolved for it", async ({ page }) => {
  test.setTimeout(360_000);
  await signIn(page, USER.email, USER.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), TINY_FIXTURE), { fileType: "vcf" });

  const response = await page.request.get("/api/export");
  expect(response.status(), "the free export answers without a fee path").toBe(200);
  const archive = new AdmZip(Buffer.from(await response.body()));
  const manifestEntry = archive.readFile("manifest.json");
  expect(manifestEntry, "the archive carries its manifest").not.toBeNull();
  const manifest = JSON.parse(manifestEntry!.toString("utf8"));

  const exported = (manifest.files ?? []).find((file: { id: string }) => file.id === fileId);
  expect(exported, "the uploaded file appears in the manifest").toBeTruthy();

  // The authority: what the database resolved, not what the route was asked to
  // echo. A unit test over a mocked query proves only that the mock was read.
  const account = await adminClient().from("genome_files").select("subject_id").eq("id", fileId).single();
  expect(account.error).toBeNull();
  expect(account.data!.subject_id, "the upload is bound to a subject at all").toBeTruthy();
  expect(exported.subject_id, "the manifest attributes the file to that subject")
    .toBe(account.data!.subject_id);

  // Scoping, not just presence: every file in the archive is attributed, and
  // to a subject this account actually holds. An archive that named someone
  // else's subject would be a disclosure, not a missing field.
  const accountId = (await findUserByEmail(adminClient(), USER.email))!.id;
  const held = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId);
  expect(held.error).toBeNull();
  const ours = new Set((held.data ?? []).map(subject => subject.id));
  expect(ours.size, "the account holds at least its own subject").toBeGreaterThan(0);
  for (const file of manifest.files ?? []) {
    expect(file.subject_id, `${file.id} is attributed`).toBeTruthy();
    expect(ours.has(file.subject_id), `${file.id} names a subject this account holds`).toBe(true);
  }

  // G5.6's rights half, settled by the operator 2026-09-11: the subject record
  // is in the archive, scoped to the requester. The scoping is the whole safety
  // argument, so it is checked against the database rather than trusted.
  const recordEntry = archive.readFile("subject-record.json");
  expect(recordEntry, "the archive carries the subject record").not.toBeNull();
  const record = JSON.parse(recordEntry!.toString("utf8"));
  // The exact set, not a subset: a table joining the archive is a disclosure
  // question and must never arrive unnoticed. `subject_demographics` is the
  // live example — it entered on 2026-09-14 with the chromosomal-sex
  // declaration (D-031) and this assertion is what caught it.
  // F4 (26 Sep 2026) added the four permission and profile classes below.
  expect(Object.keys(record).sort()).toEqual([
    "attestations", "consent_signatures", "profiles", "provider_recipient_grants", "purpose_grants",
    "subject_account_bindings", "subject_consents", "subject_demographics", "subject_principals", "subjects",
  ]);
  expect(record.subjects.length, "the person's own subject is in their own record").toBeGreaterThan(0);
  for (const subject of record.subjects) {
    expect(subject.subject_account_id, "every exported subject IS this account").toBe(accountId);
    // The export member plan withholds these (28 Sep 2026): for an adult held
    // by another uploader, owner_account_id names that other person's account.
    expect(subject, "a subject never names the account that holds it").not.toHaveProperty("owner_account_id");
    expect(subject, "or a cohort").not.toHaveProperty("cohort_id");
  }
  for (const table of ["subject_principals", "subject_account_bindings", "subject_consents",
    "provider_recipient_grants"] as const) {
    for (const row of record[table]) {
      expect(row.account_id, `${table} row belongs to this account`).toBe(accountId);
    }
  }
  // `subject_demographics` carries no account column, so its scoping is the
  // subject hop `subjectRecordOf` makes: the ids the first query already
  // narrowed to the subjects this account IS. Checked the same way as the rest.
  for (const row of record.subject_demographics) {
    expect(ours.has(row.subject_id), "a demographics row names a subject this account holds").toBe(true);
  }
  // And stated rather than left vacuous: this account declared no chromosomal
  // sex, so the table is empty here and the loop above checks nothing. A row
  // appearing would mean the export reached a subject this fixture never
  // touched. `e2e/settings.spec.ts` is where a declaration is made and read
  // back; this spec is about whose rows the archive carries.
  expect(record.subject_demographics, "no declaration was made in this account").toHaveLength(0);

  // F4: the facts and permissions a production export used to miss, each
  // checked against the database rather than trusted. The upload journey
  // records a birth date and signs its consent and disclosure, so none of
  // these checks is vacuous.
  expect(record.profiles, "exactly this account's own profile").toHaveLength(1);
  expect(record.profiles[0].id).toBe(accountId);
  expect(record.profiles[0].date_of_birth, "the birth date the upload journey recorded").toBe("1990-01-01");
  const signed = await adminClient().from("consent_signatures").select("id").eq("signer_account_id", accountId);
  expect(signed.error).toBeNull();
  const signedIds = new Set((signed.data ?? []).map(row => row.id));
  expect(signedIds.size, "the upload journey signed something").toBeGreaterThan(0);
  expect(new Set(record.consent_signatures.map((row: { id: string }) => row.id)), "every signature this account made, and no other")
    .toEqual(signedIds);
  for (const row of record.consent_signatures) {
    expect(row, "a signature never carries the encrypted signing name").not.toHaveProperty("signing_name_encrypted");
  }
  for (const grant of record.purpose_grants) {
    expect(ours.has(grant.target_id), "a purpose grant is about a subject this account IS").toBe(true);
    expect(signedIds.has(grant.signature_id), "and rests on this account's own signature").toBe(true);
  }
  const ownPrincipals = new Set(record.subject_principals.map((row: { id: string }) => row.id));
  for (const row of record.attestations) {
    expect(ownPrincipals.has(row.principal_id) || signedIds.has(row.signature_id),
      "an attestation this account's principal made or its signature carries").toBe(true);
  }
  // The manifest must not understate what the archive carries.
  const listed = (manifest.contents ?? []).find((entry: { path: string }) => entry.path === "subject-record.json");
  expect(listed, "the manifest lists the subject record").toBeTruthy();
  // Every table in the record, which is what `subjectRecordRowCount` counts.
  // The key-set assertion above is the pin that forces a deliberate look at a
  // new table; this one asks only that the manifest not understate the total.
  expect(listed.count).toBe(
    Object.values(record).reduce<number>((total, rows) => total + (rows as unknown[]).length, 0),
  );

  // L-34, owner decision of 28 Sep 2026: legal-audit.json carries the events
  // this person caused themselves. Choosing a report is one; it consumes a
  // one-time permission nonce, which is how the ledger learns who acted.
  await generateOwnFileWithChosenReports(page, fileId, ["reports.polygenic"]);
  const after = await page.request.get("/api/export");
  expect(after.status()).toBe(200);
  const afterZip = new AdmZip(Buffer.from(await after.body()));
  const audit = JSON.parse(afterZip.readFile("legal-audit.json")!.toString("utf8"));
  expect(audit.schema_version).toBe("legal-audit-v1");
  expect(Number.isNaN(Date.parse(audit.attribution_started_at)), "the file says when attribution began").toBe(false);
  const granted = audit.events.filter((event: { event_code: string; route_id: string }) =>
    event.event_code === "purpose.granted" && event.route_id === "api.consents");
  expect(granted.length, "choosing a report is recorded as this person's own act").toBeGreaterThan(0);
  for (const event of audit.events) {
    expect(Object.keys(event).sort(), "never the pseudonym or a chain hash")
      .toEqual(["coded_context", "event_code", "occurred_at", "outcome_code", "route_id", "seq"]);
  }
  // Against the ledger itself: every exported event carries one actor, and
  // the file holds every event that actor caused, none missing and none extra.
  const seqs = audit.events.map((event: { seq: number }) => event.seq);
  const rows = await adminClient().from("legal_audit_log").select("seq,audit_principal_id").in("seq", seqs);
  expect(rows.error).toBeNull();
  const actors = new Set((rows.data ?? []).map(row => row.audit_principal_id));
  expect(actors.size, "one actor").toBe(1);
  expect([...actors][0], "and it is recorded").toBeTruthy();
  const caused = await adminClient().from("legal_audit_log").select("seq").eq("audit_principal_id", [...actors][0]!);
  expect(caused.error).toBeNull();
  expect(new Set((caused.data ?? []).map(row => row.seq))).toEqual(new Set(seqs));
});
