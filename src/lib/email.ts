// Transactional email via Resend, rendering the react-email templates in
// src/emails. Both senders no-op with a console.warn when RESEND_API_KEY is
// unset, so self-hosting without email configured never crashes. Recipient
// genotype data is never logged and never included: the digest carries only
// public template info.
import { createElement, type ReactElement } from "react";
import crypto from "node:crypto";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { ReportReadyEmail, type ReportReadyProps } from "@/emails/report-ready";
import {
  ResearchDigestEmail,
  type ResearchDigestProps,
} from "@/emails/research-digest";
import {
  AccountDeletionCancelledEmail,
  AccountDeletionNoticeEmail,
  type AccountDeletionCancelledProps,
  type AccountDeletionNoticeProps,
} from "@/emails/account-deletion";
import {
  AdultSubjectInvitationEmail,
  type AdultSubjectInvitationProps,
} from "@/emails/adult-subject-invitation";
import {
  CoParentInvitationEmail,
  type CoParentInvitationProps,
} from "@/emails/co-parent-invitation";
import {
  EmbryoUploadNoticeEmail,
  type EmbryoUploadNoticeProps,
} from "@/emails/embryo-upload-notice";
import {
  RecordKeyAddendumEmail,
  type RecordKeyAddendumProps,
} from "@/emails/record-key-addendum";
import {
  EmbryoDispositionNoticeEmail,
  type EmbryoDispositionNoticeProps,
} from "@/emails/embryo-disposition-notice";
import {
  CohortRestrictionNoticeEmail,
  type CohortRestrictionNoticeProps,
} from "@/emails/cohort-restriction-notice";
import {
  EmbryoDraftExpiredEmail,
  type EmbryoDraftExpiredProps,
} from "@/emails/embryo-draft-expired";
import {
  EmbryoIngestAbandonedEmail,
  type EmbryoIngestAbandonedProps,
} from "@/emails/embryo-ingest-abandoned";

/** Every template id, paired with the props its component renders. */
interface MailPayloads {
  "report-ready": ReportReadyProps;
  "research-digest": ResearchDigestProps;
  "account-deletion-notice": AccountDeletionNoticeProps;
  "account-deletion-cancelled": AccountDeletionCancelledProps;
  "adult-subject-invitation": AdultSubjectInvitationProps;
  "co-parent-invitation": CoParentInvitationProps;
  "embryo-upload-notice": EmbryoUploadNoticeProps;
  "record-key-addendum": RecordKeyAddendumProps;
  "embryo-disposition-notice": EmbryoDispositionNoticeProps;
  "cohort-restriction-notice": CohortRestrictionNoticeProps;
  "embryo-draft-expired": EmbryoDraftExpiredProps;
  "embryo-ingest-abandoned": EmbryoIngestAbandonedProps;
}

export type MailTemplateId = keyof MailPayloads;

/** One template id with the payload that id renders; the union of all of them. */
export type MailTemplate = {
  [K in MailTemplateId]: { id: K; payload: MailPayloads[K] };
}[MailTemplateId];

// Rendering is a lookup keyed by id. The mapped type ties each entry to its
// own payload, so a template cannot be wired to another template's props.
const renderers: {
  [K in MailTemplateId]: (payload: MailPayloads[K]) => ReactElement;
} = {
  "report-ready": (payload) => createElement(ReportReadyEmail, payload),
  "research-digest": (payload) => createElement(ResearchDigestEmail, payload),
  "account-deletion-notice": (payload) =>
    createElement(AccountDeletionNoticeEmail, payload),
  "account-deletion-cancelled": (payload) =>
    createElement(AccountDeletionCancelledEmail, payload),
  "adult-subject-invitation": (payload) =>
    createElement(AdultSubjectInvitationEmail, payload),
  "co-parent-invitation": (payload) =>
    createElement(CoParentInvitationEmail, payload),
  "embryo-upload-notice": (payload) =>
    createElement(EmbryoUploadNoticeEmail, payload),
  "record-key-addendum": (payload) =>
    createElement(RecordKeyAddendumEmail, payload),
  "embryo-disposition-notice": (payload) =>
    createElement(EmbryoDispositionNoticeEmail, payload),
  "cohort-restriction-notice": (payload) =>
    createElement(CohortRestrictionNoticeEmail, payload),
  // The expiry notice carries no data, so its payload is not read.
  "embryo-draft-expired": () => createElement(EmbryoDraftExpiredEmail),
  "embryo-ingest-abandoned": () => createElement(EmbryoIngestAbandonedEmail),
};

// Subjects are fixed per template. The Record Key addendum is the one
// exception: its subject follows the kind of change it announces.
const subjects: { [K in Exclude<MailTemplateId, "record-key-addendum">]: string } = {
  "report-ready": "Your Inherit reports are ready",
  "research-digest": "New reports in the Inherit research library",
  "account-deletion-notice": "Your Inherit account deletion is scheduled",
  "account-deletion-cancelled": "Your Inherit account deletion was cancelled",
  "adult-subject-invitation": "You were invited to Inherit",
  "co-parent-invitation": "You were named as a genetic parent on Inherit",
  "embryo-upload-notice": "Embryo records were added on Inherit",
  "embryo-disposition-notice": "A disposition was recorded for one embryo record",
  "cohort-restriction-notice": "Embryo records were withdrawn and are being deleted",
  "embryo-draft-expired": "An embryo upload draft expired",
  "embryo-ingest-abandoned": "The embryo upload did not complete",
};

const addendumSubjects: Record<RecordKeyAddendumProps["kind"], string> = {
  "date-changed": "The closing date on your Record Key Card changed",
  "no-source": "No genetic file was kept for one embryo",
  "card-invalidated": "Your Record Key Cards are no longer valid",
};

export function mailSubject(mail: MailTemplate): string {
  if (mail.id === "record-key-addendum") {
    return addendumSubjects[mail.payload.kind];
  }
  return subjects[mail.id];
}

// Generic over the id so the renderer chosen by `mail.id` is called with the
// payload type that belongs to that id.
export function renderMail<K extends MailTemplateId>(mail: {
  id: K;
  payload: MailPayloads[K];
}): Promise<string> {
  return render(renderers[mail.id](mail.payload));
}

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

  const subject = mailSubject(mail);
  const html = await renderMail(mail);

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
