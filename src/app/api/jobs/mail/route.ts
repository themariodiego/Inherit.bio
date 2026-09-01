import { NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret, hmacSecret } from "@/lib/crypto";
import { submitMail, type MailTemplate } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const reportReadyPayload = z.object({
  reportCount: z.number().int().nonnegative().max(10_000),
  dashboardUrl: z.url(),
}).strict();

const researchDigestPayload = z.object({
  entries: z.array(z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2_000),
    url: z.url(),
  }).strict()).min(1).max(25),
  manageUrl: z.url(),
}).strict();

const accountDeletionNoticePayload = z
  .object({
    noticeEndsAt: z.iso.datetime({ offset: true }),
    cancelPath: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
    exportPath: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
  })
  .strict();

const accountDeletionCancelledPayload = z
  .object({
    settingsPath: z.string().regex(/^\/[A-Za-z0-9/_-]*$/),
  })
  .strict();

const adultSubjectInvitationPayload = z.object({}).strict();

function applicationUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.inherit.bio";
  return new URL(path, base).toString();
}

function parseMail(
  templateId: string,
  payload: unknown,
  deliveryToken?: string | null,
): MailTemplate {
  if (templateId === "report-ready") {
    return { id: templateId, payload: reportReadyPayload.parse(payload) };
  }
  if (templateId === "research-digest") {
    return { id: templateId, payload: researchDigestPayload.parse(payload) };
  }
  if (templateId === "account-deletion-notice") {
    const parsed = accountDeletionNoticePayload.parse(payload);
    return {
      id: templateId,
      payload: {
        noticeEndsAt: parsed.noticeEndsAt,
        cancelUrl: applicationUrl(parsed.cancelPath),
        exportUrl: applicationUrl(parsed.exportPath),
      },
    };
  }
  if (templateId === "account-deletion-cancelled") {
    const parsed = accountDeletionCancelledPayload.parse(payload);
    return {
      id: templateId,
      payload: { settingsUrl: applicationUrl(parsed.settingsPath) },
    };
  }
  if (templateId === "adult-subject-invitation") {
    adultSubjectInvitationPayload.parse(payload);
    if (!deliveryToken || !/^[A-Za-z0-9_-]{43}$/.test(deliveryToken)) {
      throw new Error("mail_token_unavailable");
    }
    return {
      id: templateId,
      payload: {
        invitationUrl: applicationUrl(`/withdraw/${deliveryToken}`),
      },
    };
  }
  throw new Error("mail_template_unknown");
}

function authorized(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  for (const secret of [process.env.JOBS_SECRET, process.env.CRON_SECRET]) {
    if (secret && authorization === `Bearer ${secret}`) return true;
  }
  return false;
}

function requestHasSelectors(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.search.length > 0 ||
    request.headers.has("transfer-encoding") ||
    Number(request.headers.get("content-length") ?? "0") > 0
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (new URL(request.url).search.length > 0) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return drainMail();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (requestHasSelectors(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return drainMail();
}

async function drainMail() {
  const admin = createAdminClient();
  let processed = 0;
  let failed = 0;

  // The request cannot choose a batch size or row. A fixed bound keeps one
  // invocation predictable while the database chooses due work with
  // FOR UPDATE SKIP LOCKED.
  for (let index = 0; index < 25; index++) {
    const { data, error } = await admin.rpc("claim_mail_outbox");
    if (error) {
      if (processed === 0) {
        return NextResponse.json({ error: "worker_unavailable" }, { status: 503 });
      }
      break;
    }
    const row = data?.[0];
    if (!row) break;

    let recipient = "";
    try {
      const ciphertextHex = row.contact_ciphertext.replace(/^\\x/, "");
      recipient = decryptSecret(Buffer.from(ciphertextHex, "hex"));
      const mail = parseMail(
        row.template_id,
        row.template_payload,
        row.delivery_token,
      );
      const providerMessageId = await submitMail(
        recipient,
        mail,
        row.idempotency_key,
      );
      recipient = "";

      const { error: completionError } = await admin.rpc(
        "complete_mail_attempt",
        {
          p_outbox_id: row.outbox_id,
          p_attempt_ordinal: row.attempt_ordinal,
          p_success: true,
          p_provider_message_id_hmac: hmacSecret(
            providerMessageId,
            "resend-message-id-v1",
          ),
          p_outcome_code: "accepted",
        },
      );
      if (completionError) throw new Error("mail_completion_failed");
      processed++;
    } catch {
      recipient = "";
      await admin.rpc("complete_mail_attempt", {
        p_outbox_id: row.outbox_id,
        p_attempt_ordinal: row.attempt_ordinal,
        p_success: false,
        p_provider_message_id_hmac: "",
        p_outcome_code: "provider_or_payload_error",
      });
      failed++;
    }
  }

  const now = new Date().toISOString();
  const { count: pending } = await admin
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .eq("state", "queued")
    .lte("not_before", now)
    .gt("expires_at", now);

  return NextResponse.json({ processed, failed, pending: pending ?? 0 });
}
