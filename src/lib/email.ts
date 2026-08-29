// Transactional email via Resend, rendering the react-email templates in
// src/emails. Both senders no-op with a console.warn when RESEND_API_KEY is
// unset, so self-hosting without email configured never crashes. Recipient
// genotype data is never logged and never included: the digest carries only
// public template info.
import { createElement } from "react";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { ReportReadyEmail, type ReportReadyProps } from "@/emails/report-ready";
import {
  ResearchDigestEmail,
  type ResearchDigestProps,
} from "@/emails/research-digest";

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function from(): string {
  return process.env.EMAIL_FROM ?? "Inherit <onboarding@resend.dev>";
}

async function send(
  to: string,
  subject: string,
  html: string,
  label: string,
): Promise<boolean> {
  const resend = client();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY unset; skipping ${label} email`);
    return false;
  }
  const { error } = await resend.emails.send({ from: from(), to, subject, html });
  if (error) console.error(`[email] ${label} send failed:`, error.message);
  return !error;
}

export async function sendReportReady(
  to: string,
  props: ReportReadyProps,
): Promise<boolean> {
  const html = await render(createElement(ReportReadyEmail, props));
  return send(to, "Your Inherit reports are ready", html, "report-ready");
}

export async function sendResearchDigest(
  to: string,
  props: ResearchDigestProps,
): Promise<boolean> {
  const html = await render(createElement(ResearchDigestEmail, props));
  return send(to, "New reports in the Inherit research library", html, "research-digest");
}
