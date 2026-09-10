import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFilePrepared } from "./own-report-helpers";

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
  test.setTimeout(240_000);
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
  const held = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", (await adminClient().auth.admin.listUsers())
      .data.users.find(user => user.email === USER.email)!.id);
  expect(held.error).toBeNull();
  const ours = new Set((held.data ?? []).map(subject => subject.id));
  expect(ours.size, "the account holds at least its own subject").toBeGreaterThan(0);
  for (const file of manifest.files ?? []) {
    expect(file.subject_id, `${file.id} is attributed`).toBeTruthy();
    expect(ours.has(file.subject_id), `${file.id} names a subject this account holds`).toBe(true);
  }
});
