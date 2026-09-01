import AdmZip from "adm-zip";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";

// A13 — export contains originals + normalized variants; account deletion is
// held for the fixed notice period and remains cancellable before purge starts.

const USER = { email: "delete-me@e2e.local", password: "e2e-delete-pw" };

test.describe.configure({ mode: "serial" });

let userId: string;

test.beforeAll(async () => {
  userId = await createConfirmedUser(USER.email, USER.password);
});

test("export ZIP contains manifest, original upload, and variant CSV — free, no fee path", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);
  const vcfFileId = await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "data/samples/HG001_GRCh38_chr20-22.vcf.gz"),
    "vcf",
  );
  // The HG001 fixture's ID column is all "." (no rs IDs), so rsid-keyed
  // report resolution covers nothing against it. Ingest the tiny rsid-bearing
  // VCF too (rs762551 het — the report-gate control case) so the export
  // contains at least one covered report for the reports.txt assertions.
  await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    "vcf",
  );

  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/zip");
  expect(res.headers()["content-disposition"]).toContain("inherit-export-");
  const zip = new AdmZip(Buffer.from(await res.body()));
  const names = zip.getEntries().map((e) => e.entryName);

  expect(names).toContain("manifest.json");
  expect(names).toContain("reports.json");
  expect(names).toContain("prs.json");
  expect(names).toContain("chats.json");
  expect(names.some((n) => n.startsWith("originals/"))).toBe(true);
  expect(names.some((n) => n.startsWith("variants/") && n.endsWith(".csv"))).toBe(true);

  const manifest = JSON.parse(zip.readAsText("manifest.json")) as {
    contents: { path: string }[];
    files: {
      id: string;
      original_name: string;
      sha256: string | null;
      variant_count: number | null;
      row_count: number;
    }[];
    warnings?: string[];
    note: string;
  };
  expect(manifest.files.length).toBeGreaterThan(0);
  expect(manifest.note).toContain("free");
  // The manifest must account for the privacy policy's export promise verbatim.
  expect(manifest.note).toContain(
    "your original uploaded files, all derived variants, all reports, and your chat history",
  );
  expect(manifest.warnings ?? []).toHaveLength(0);

  // The big fixture's CSV, targeted by id (the tiny rsid VCF adds a second
  // variants/ entry, so find()-by-prefix would be ambiguous).
  const csvName = `variants/${vcfFileId}.csv`;
  expect(names).toContain(csvName);
  const csv = zip.readAsText(csvName);
  expect(csv.split("\n")[0]).toBe("rsid,chrom,pos_grch38,ref,alt,genotype");
  expect(csv.split("\n").length).toBeGreaterThan(1000);

  // The CSV must contain every variant row — a PostgREST page cap (1,000
  // rows by default) must never silently truncate the export again.
  const fileId = vcfFileId;
  const { data: gf } = await adminClient()
    .from("genome_files")
    .select("variant_count")
    .eq("id", fileId)
    .single();
  const variantCount = (gf as { variant_count: number | null }).variant_count;
  expect(variantCount).toBeGreaterThan(1000);
  const dataRows = csv.trimEnd().split("\n").length - 1; // minus header
  expect(dataRows).toBe(variantCount);
  const manifestFile = manifest.files.find((f) => f.id === fileId)!;
  expect(manifestFile.row_count).toBe(variantCount);

  // reports.json resolves the report library against the processed file.
  const reports = JSON.parse(zip.readAsText("reports.json")) as {
    file_id: string;
    reports: { slug: string; title: string }[];
  }[];
  expect(reports.some((f) => f.file_id === fileId)).toBe(true);
  for (const f of reports) {
    expect(f.reports.every((r) => !r.slug.startsWith("auto-e2e-"))).toBe(true);
  }

  // reports.txt is the human-readable rendering of the same data: it must
  // exist and carry every covered report's title (at least one — the tiny
  // VCF's rs762551 het resolves the seeded caffeine-metabolism report).
  expect(names).toContain("reports.txt");
  expect(manifest.contents.some((c) => c.path === "reports.txt")).toBe(true);
  const reportsTxt = zip.readAsText("reports.txt");
  const coveredTitles = reports.flatMap((f) => f.reports.map((r) => r.title));
  expect(coveredTitles.length).toBeGreaterThan(0);
  for (const title of coveredTitles) {
    expect(reportsTxt).toContain(title);
  }

  // prs.json is present and parseable (an array; may be empty for this file).
  expect(Array.isArray(JSON.parse(zip.readAsText("prs.json")))).toBe(true);
});

test("account deletion schedules a seven-day hold and can be cancelled", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);

  await page.goto("/settings/data");
  await page.getByLabel(/Type/).fill("delete my genome");
  await page.getByTestId("delete-account").click();
  await expect(
    page.getByRole("heading", { name: "Account deletion scheduled" }),
  ).toBeVisible();

  const admin = adminClient();

  const { data: users } = await admin.auth.admin.listUsers();
  expect(users?.users.find((user) => user.id === userId)).toBeDefined();

  const { data: deletion } = await admin
    .from("account_deletion_requests")
    .select("id,state,requested_at,notice_ends_at")
    .eq("account_id", userId)
    .eq("state", "notice_period")
    .order("requested_at", { ascending: false })
    .limit(1)
    .single();
  expect(deletion?.state).toBe("notice_period");
  expect(
    new Date(deletion!.notice_ends_at).getTime() -
      new Date(deletion!.requested_at).getTime(),
  ).toBe(7 * 24 * 60 * 60 * 1000);

  const { data: profile } = await admin
    .from("profiles")
    .select("deletion_requested_at")
    .eq("id", userId)
    .single();
  expect(profile?.deletion_requested_at).not.toBeNull();

  const { data: retention } = await admin
    .from("retention_rows")
    .select("id,state,fixed_deadline")
    .eq("retention_id", "account-deletion.notice-7d")
    .eq("target_id", userId)
    .single();
  expect(retention?.state).toBe("scheduled");
  expect(retention?.fixed_deadline).toBe(deletion?.notice_ends_at);

  const { data: phase } = await admin
    .from("retention_due_phases")
    .select("status,phase_deadline")
    .eq("retention_row_id", retention!.id)
    .single();
  expect(phase?.status).toBe("pending");
  expect(phase?.phase_deadline).toBe(deletion?.notice_ends_at);

  const { data: manifest } = await admin
    .from("purge_manifests")
    .select("state,manifest_class")
    .eq("retention_row_id", retention!.id)
    .single();
  expect(manifest).toMatchObject({
    state: "frozen",
    manifest_class: "complete-retention",
  });

  const { count: noticeCount } = await admin
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .eq("target_id", deletion!.id)
    .eq("template_id", "account-deletion-notice");
  expect(noticeCount).toBe(1);

  // Physical data and joined UUID storage objects remain throughout notice.
  const { data: files } = await admin
    .from("genome_files")
    .select("id,storage_object_id")
    .eq("user_id", userId);
  expect(files?.length).toBeGreaterThan(0);
  const { data: objects } = await admin
    .from("genome_storage_objects")
    .select("object_name,bucket_id,state")
    .in("genome_file_id", files!.map((file) => file.id));
  expect(objects?.length).toBe(files?.length);
  for (const object of objects ?? []) {
    expect(object.state).toBe("current");
    const { data: stored } = await admin.storage
      .from(object.bucket_id)
      .list("", { search: object.object_name });
    expect(stored?.some((entry) => entry.name === object.object_name)).toBe(true);
  }

  // During notice, non-allowlisted application operations are locked.
  const blocked = await page.request.post("/api/chat", { data: {} });
  expect(blocked.status()).toBe(423);
  await page.goto("/overview");
  await page.waitForURL((url) => url.pathname === "/settings/data");

  await page.getByTestId("cancel-account-deletion").click();
  await expect(
    page.getByRole("heading", { name: "Delete account" }),
  ).toBeVisible();

  const { data: cancelled } = await admin
    .from("account_deletion_requests")
    .select("state,cancelled_at")
    .eq("id", deletion!.id)
    .single();
  expect(cancelled?.state).toBe("cancelled");
  expect(cancelled?.cancelled_at).not.toBeNull();
  const { data: restoredProfile } = await admin
    .from("profiles")
    .select("deletion_requested_at")
    .eq("id", userId)
    .single();
  expect(restoredProfile?.deletion_requested_at).toBeNull();

  await page.goto("/overview");
  await expect(page).toHaveURL(/\/overview$/);
});
