import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

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
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser: ${error.message}`);
    return existing.id;
  }
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
  await page.waitForURL(/\/(?:dashboard|overview)/);
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
  const fs = await import("node:fs");
  const nodeCrypto = await import("node:crypto");
  const path = await import("node:path");
  const bytes = fs.readFileSync(filePath);
  const sha256 = nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  const issue = await page.request.post("/api/files/upload-session", {
    data: {
      originalName: path.basename(filePath),
      fileType,
      sizeBytes: bytes.length,
      sha256,
      contentType: "application/octet-stream",
    },
  });
  if (!issue.ok()) throw new Error(`issue: ${issue.status()} ${await issue.text()}`);
  const issued = (await issue.json()) as {
    uploadId: string;
    bucketName: string;
    objectName: string;
    tier: 1 | 2;
  };
  const { error: upErr } = await client.storage
    .from(issued.bucketName)
    .upload(issued.objectName, bytes, { contentType: "application/octet-stream" });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const complete = await page.request.post(`/api/files/${issued.uploadId}/finalize`, {
    data: {
      originalName: path.basename(filePath),
      fileType,
      tier: issued.tier,
    },
  });
  if (!complete.ok()) {
    throw new Error(`complete: ${complete.status()} ${await complete.text()}`);
  }
  const { fileId } = (await complete.json()) as { fileId: string };

  const res = await page.request.post(`/api/files/${fileId}/process`);
  if (!res.ok()) {
    throw new Error(`process: ${res.status()} ${await res.text()}`);
  }
  return fileId;
}

/**
 * Seeded, non-fixture report templates in data/templates — the only library
 * count a product surface may show. Read from disk so no spec hard-codes the
 * number; fixture templates (auto-e2e-*) published by the research spec are
 * excluded by isFixtureSlug on every surface.
 */
export function seededTemplateCount(): number {
  const dir = path.join(process.cwd(), "data/templates");
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const templates = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
      slug: string;
    }[];
    count += templates.filter((t) => !t.slug.startsWith("auto-e2e-")).length;
  }
  return count;
}

/**
 * X6.1 basis, identical to scripts/density-baseline/capture.mjs: rendered
 * interactive elements whose top edge is inside the first viewport, excluding
 * persistent navigation (anything inside a `nav`), the skip link and the
 * Copilot entry control. Shared by the specs that pin the first-viewport
 * budget (`overview.spec.ts`, `genome-data.spec.ts`).
 */
export async function firstViewportInteractives(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.matches('a[href="#main"]')) continue;
      if (element.closest("nav,[data-copilot-entry]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element.getClientRects().length === 0) continue;
      if (rect.top >= window.innerHeight) continue;
      found.push(
        `${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 40)}`,
      );
    }
    return found;
  });
}
