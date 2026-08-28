import AdmZip from "adm-zip";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { adminClient, createConfirmedUser, ingestFileAs, signIn } from "./helpers";

// A13 — export contains originals + normalized variants; deletion removes
// DB rows AND storage objects, verified by privileged re-query afterwards.

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
  await ingestFileAs(
    page,
    USER.email,
    USER.password,
    path.join(process.cwd(), "data/samples/HG001_GRCh38_chr20-22.vcf.gz"),
    "vcf",
  );

  const res = await page.request.get("/api/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/zip");
  const zip = new AdmZip(Buffer.from(await res.body()));
  const names = zip.getEntries().map((e) => e.entryName);

  expect(names).toContain("manifest.json");
  expect(names.some((n) => n.startsWith("originals/"))).toBe(true);
  expect(names.some((n) => n.startsWith("variants/") && n.endsWith(".csv"))).toBe(true);

  const manifest = JSON.parse(zip.readAsText("manifest.json")) as {
    files: { original_name: string; sha256: string | null }[];
    note: string;
  };
  expect(manifest.files.length).toBeGreaterThan(0);
  expect(manifest.note).toContain("free");

  const csvName = names.find((n) => n.startsWith("variants/"))!;
  const csv = zip.readAsText(csvName);
  expect(csv.split("\n")[0]).toBe("rsid,chrom,pos_grch38,ref,alt,genotype");
  expect(csv.split("\n").length).toBeGreaterThan(1000);
});

test("account deletion removes auth user, all rows, and all storage objects", async ({
  page,
}) => {
  await signIn(page, USER.email, USER.password);

  await page.goto("/settings");
  await page.getByLabel(/Type/).fill("delete my genome");
  await page.getByTestId("delete-account").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });

  const admin = adminClient();

  const { data: users } = await admin.auth.admin.listUsers();
  expect(users?.users.find((u) => u.id === userId)).toBeUndefined();

  for (const table of [
    "profiles",
    "genome_files",
    "user_variants",
    "ancestry_results",
    "user_prs",
    "chats",
    "consent_grants",
  ]) {
    const { data } = await admin
      .from(table)
      .select("*")
      .eq(table === "profiles" ? "id" : "user_id", userId);
    expect(data ?? [], `${table} rows must be gone`).toHaveLength(0);
  }

  // Storage: nothing under the user's prefix, at any depth.
  const { data: topLevel } = await admin.storage.from("genomes").list(userId);
  expect(topLevel ?? []).toHaveLength(0);
});
