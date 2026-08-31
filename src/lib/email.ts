// Transactional email via Resend, rendering the react-email templates in
// src/emails. Both senders no-op with a console.warn when RESEND_API_KEY is
// unset, so self-hosting without email configured never crashes. Recipient
// genotype data is never logged and never included: the digest carries only
// public template info.
import { createElement } from "react";
import crypto from "node:crypto";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { ReportReadyEmail, type ReportReadyProps } from "@/emails/report-ready";
import {
  ResearchDigestEmail,
  type ResearchDigestProps,
} from "@/emails/research-digest";

export type MailTemplate =
  | {
      id: "report-ready";
      payload: ReportReadyProps;
    }
  | {
      id: "research-digest";
      payload: ResearchDigestProps;
    };

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function from(): string {
  const value = process.env.EMAIL_FROM;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_FROM must use a verified sender in production");
  }
  return "Inherit <onboarding@resend.dev>";
}

export async function submitMail(
  to: string,
  mail: MailTemplate,
  idempotencyKey: string,
): Promise<string> {
  const resend = client();
  if (!resend) {
    throw new Error("mail_provider_unavailable");
  }

  const subject =
    mail.id === "report-ready"
      ? "Your Inherit reports are ready"
      : "New reports in the Inherit research library";
  const html =
    mail.id === "report-ready"
      ? await render(createElement(ReportReadyEmail, mail.payload))
      : await render(createElement(ResearchDigestEmail, mail.payload));

  const { data, error } = await resend.emails.send(
    { from: from(), to, subject, html },
    { idempotencyKey },
  );
  if (error || !data?.id) throw new Error("mail_provider_rejected");
  return data.id;
}

export async function sendReportReady(
  to: string,
  props: ReportReadyProps,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!client()) {
    console.warn("[email] RESEND_API_KEY unset; skipping report-ready email");
    return false;
  }
  try {
    await submitMail(to, { id: "report-ready", payload: props }, idempotencyKey ?? crypto.randomUUID());
    return true;
  } catch {
    return false;
  }
}

export async function sendResearchDigest(
  to: string,
  props: ResearchDigestProps,
  idempotencyKey?: string,
): Promise<boolean> {
  if (!client()) {
    console.warn("[email] RESEND_API_KEY unset; skipping research-digest email");
    return false;
  }
  try {
    await submitMail(to, { id: "research-digest", payload: props }, idempotencyKey ?? crypto.randomUUID());
    return true;
  } catch {
    return false;
  }
}
