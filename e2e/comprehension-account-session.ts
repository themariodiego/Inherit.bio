import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import bindings from "../scripts/comprehension/bindings.json";
import { taskCompleted, type BoundTask } from "../scripts/comprehension/completion";
import type { TaskId } from "../scripts/comprehension/conductor-contract";
import { openLiveSession, type InboxMessage } from "../scripts/comprehension/live-browser";
import { OWN_REPORT_PURPOSES, type OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";
import { EMAIL_LABEL } from "../src/copy/family/invite";
import { adminClient, adultInvitationToken, adultInvitationUrl, createConfirmedUser, drainMailUntil, findUserByEmail, signIn, SUPABASE_URL } from "./helpers";
import { generateOwnFileWithChosenReports, uploadOwnFilePrepared } from "./own-report-helpers";

const PASSWORD = "e2e-comprehension-participant-pw";
const BASE_URL = "http://localhost:3100";
export type ComprehensionMail = { to: string[] | string; subject?: string; html?: string; text?: string };
type Account = { id: string; files: string[]; seed?: { fileTypes: string[]; purposes: string[] } | null };
const accounts = bindings.accounts as unknown as Account[];
const boundTask = (id: TaskId) => bindings.tasks.find(task => task.id === id) as unknown as BoundTask;

function purposesOf(purposes: string[]): [OwnReportPurpose, ...OwnReportPurpose[]] {
  const chosen = purposes.filter((purpose): purpose is OwnReportPurpose => (OWN_REPORT_PURPOSES as readonly string[]).includes(purpose));
  if (!chosen.length || chosen.length !== purposes.length) throw new Error("Bound report choices must be supported purposes");
  return chosen as [OwnReportPurpose, ...OwnReportPurpose[]];
}

/** The same steps the named-account seed takes, for a session's own address. */
async function seedAccount(page: Page, account: Account, email: string) {
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  if (!account.files.length) return;
  const purposes = purposesOf(account.seed?.purposes ?? []);
  for (const [index, file] of account.files.entries()) {
    const fileId = await uploadOwnFilePrepared(page, path.resolve(file), { fileType: account.seed!.fileTypes[index] });
    await generateOwnFileWithChosenReports(page, fileId, purposes);
  }
}

const plain = (html = "") => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<a [^>]*>[\s\S]*?<\/a>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 1500);

/** The original a/b/no-account product paths, shared by the ordinary and
 * exclusive fresh launchers. No native result or permission rows are seeded. */
export async function openComprehensionAccountSession({ browser, id, taskId, accountId, email, mail }: {
  browser: Browser; id: string; taskId: TaskId; accountId: string; email: string; mail: ComprehensionMail[];
}) {
  const account = accounts.find(candidate => candidate.id === accountId);
  if (!account || account.id === "participant-c") throw new Error("Ordinary account adapter cannot seed participant-c");

  const task = boundTask(taskId);
  let inbox: InboxMessage[] | undefined;
  if (taskId === "T9") inbox = [await reserveAndInvite(browser, email, `${email.split("@")[0]}-reserver@e2e.local`, mail)];
  const signedIn = account.id !== "no-account";
  const session = await openLiveSession({ browser, sessionId: id, baseURL: BASE_URL, allowedOrigins: [BASE_URL, SUPABASE_URL],
    startPath: signedIn ? "/overview" : "/", textLimit: 12_000, actionTimeoutMs: 10_000, inbox,
    prepare: signedIn ? page => seedAccount(page, account, email) : undefined,
    complete: async ({ paths, context, diagnostics }) => {
      const admin = adminClient();
      let accountDeletionScheduled: boolean | undefined, accountCreated: boolean | undefined;
      if (taskId === "T8") {
        const user = await findUserByEmail(admin, email);
        const { data } = await admin.from("account_deletion_requests").select("id").eq("account_id", user?.id ?? "")
          .in("state", ["notice_period", "delete_started"]).limit(1);
        accountDeletionScheduled = Boolean(data?.length);
      }
      if (!signedIn) {
        const cookies = await context.cookies();
        const typed = await Promise.all(diagnostics.typedEmails.map(address => findUserByEmail(admin, address)));
        accountCreated = cookies.some(cookie => /^sb-.*-auth-token/.test(cookie.name)) || typed.some(Boolean);
      }
      return taskCompleted(task, { paths, accountDeletionScheduled, accountCreated });
    } });
  return session;
}

async function reserveAndInvite(browser_: Browser, invitee: string, reserverEmail: string, mail: ComprehensionMail[]): Promise<InboxMessage> {
  const context = await browser_.newContext({ baseURL: BASE_URL });
  try {
    const page = await context.newPage();
    await createConfirmedUser(reserverEmail, PASSWORD);
    await signIn(page, reserverEmail, PASSWORD);
    await page.goto("/family/invite");
    await page.getByLabel(EMAIL_LABEL).fill(invitee);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status")).toContainText("Invitation requested");
    const message = await drainMailUntil(page.request, () => mail.find(email =>
      (Array.isArray(email.to) ? email.to : [email.to]).includes(invitee)), "T9's invitation");
    const token = adultInvitationToken(message.html);
    if (!token) throw new Error("T9's invitation carries no review link");
    return { subject: message.subject ?? "(no subject)", text: plain(message.html),
      links: [{ id: "m1", label: "The link in this email", url: adultInvitationUrl(token, BASE_URL) }] };
  } finally { await context.close(); }
}
