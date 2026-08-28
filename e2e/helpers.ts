import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

export const SUPABASE_URL = "http://127.0.0.1:54321";
export const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const MAILPIT_URL = "http://127.0.0.1:54324";
export const JOBS_SECRET = "e2e-jobs-secret";

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
}

/** Create a confirmed user directly (bypasses the email flow — auth.spec
 * covers that flow itself). Returns the user id. */
export async function createConfirmedUser(
  email: string,
  password: string,
): Promise<string> {
  const admin = adminClient();
  // Idempotent: remove any leftover user with this email first.
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

/** Sign the browser session in through the UI. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** Latest Mailpit message to an address, with its HTML+text body. */
export async function latestEmailTo(
  address: string,
  { timeoutMs = 30_000 } = {},
): Promise<{ subject: string; body: string } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { messages: MailpitMessage[] };
      const msg = json.messages?.[0];
      if (msg) {
        const bodyRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
        const body = (await bodyRes.json()) as {
          Text: string;
          HTML: string;
          Subject: string;
        };
        return { subject: body.Subject, body: `${body.Text}\n${body.HTML}` };
      }
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function clearMailbox() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/**
 * Upload a local file for the user signed into `page` (storage + row via
 * supabase-js with their credentials, processing trigger via the page's own
 * session cookies). The upload UI itself is covered by upload specs; this
 * exists for specs that need a processed file as a precondition.
 */
export async function ingestFileAs(
  page: Page,
  email: string,
  password: string,
  filePath: string,
  fileType: string,
): Promise<string> {
  const client = anonClient();
  const { data: session, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !session.session) throw new Error(`sign-in: ${error?.message}`);
  const userId = session.session.user.id;

  const fs = await import("node:fs");
  const path = await import("node:path");
  const bytes = fs.readFileSync(filePath);
  const objectName = `${userId}/${crypto.randomUUID()}/${path.basename(filePath)}`;
  const { error: upErr } = await client.storage
    .from("genomes")
    .upload(objectName, bytes, { contentType: "application/octet-stream" });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: row, error: rowErr } = await client
    .from("genome_files")
    .insert({
      user_id: userId,
      bucket_path: objectName,
      original_name: path.basename(filePath),
      file_type: fileType,
      tier: 1,
      size_bytes: bytes.length,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (rowErr || !row) throw new Error(`row: ${rowErr?.message}`);

  const res = await page.request.post(`/api/files/${row.id}/process`);
  if (!res.ok()) {
    throw new Error(`process: ${res.status()} ${await res.text()}`);
  }
  return row.id as string;
}
