import type { MailTemplate, MailTemplateId } from "../email";
import type { RequiredSurface } from "./corpus";

/** Every production renderer must have an independently discovered component export. */
export const EMAIL_RENDERERS = {
  "report-ready": ["report-ready.tsx", "ReportReadyEmail"],
  "research-digest": ["research-digest.tsx", "ResearchDigestEmail"],
  "account-deletion-notice": ["account-deletion.tsx", "AccountDeletionNoticeEmail"],
  "account-deletion-cancelled": ["account-deletion.tsx", "AccountDeletionCancelledEmail"],
  "adult-subject-invitation": ["adult-subject-invitation.tsx", "AdultSubjectInvitationEmail"],
  "co-parent-invitation": ["co-parent-invitation.tsx", "CoParentInvitationEmail"],
  "embryo-upload-notice": ["embryo-upload-notice.tsx", "EmbryoUploadNoticeEmail"],
  "record-key-addendum": ["record-key-addendum.tsx", "RecordKeyAddendumEmail"],
  "embryo-disposition-notice": ["embryo-disposition-notice.tsx", "EmbryoDispositionNoticeEmail"],
  "cohort-restriction-notice": ["cohort-restriction-notice.tsx", "CohortRestrictionNoticeEmail"],
  "embryo-draft-expired": ["embryo-draft-expired.tsx", "EmbryoDraftExpiredEmail"],
  "embryo-ingest-abandoned": ["embryo-ingest-abandoned.tsx", "EmbryoIngestAbandonedEmail"],
  "invitation-terminal-notice": ["invitation-terminal-notice.tsx", "InvitationTerminalNoticeEmail"],
} as const satisfies Record<MailTemplateId, readonly [string, string]>;

export interface PublicDigestTemplate { slug: string; title: string; summary: string }
export interface EmailFixture {
  id: string;
  entrypoint: string;
  exportName: string;
  mail: MailTemplate;
  required: RequiredSurface;
}

/** Synthetic inputs only; digest prose comes from the actual public seed catalog. */
export function emailFixtures(catalog: readonly PublicDigestTemplate[]): EmailFixture[] {
  if (!catalog.length || new Set(catalog.map((t) => t.slug)).size !== catalog.length ||
      catalog.some((t) => !t.slug || !t.title || !t.summary)) throw new Error("email-capture:invalid-public-catalog");
  const url = "https://example.test/fixture";
  const result: EmailFixture[] = [];
  const add = (variant: string, mail: MailTemplate) => {
    const id = `${mail.id}--${variant}`, [file, exportName] = EMAIL_RENDERERS[mail.id];
    const entrypoint = `src/emails/${file}`;
    result.push({ id, entrypoint, exportName, mail, required: { channel: "email", surface: `email:${entrypoint}#fixture=${id}`,
      requiresClaimWrapping: false, requiredClaimRegions: ["email-body",
        ...(mail.id === "research-digest" && mail.payload.entries.length ? ["research-digest-entries"] : [])] } });
  };
  for (const count of [0, 1, 162]) add(`count-${count}`, { id: "report-ready", payload: { reportCount: count, dashboardUrl: url } });
  const entries = [...catalog].sort((a, b) => a.slug.localeCompare(b.slug)).map((t) => ({ title: t.title, summary: t.summary, url: `${url}/${t.slug}` }));
  for (const [name, selected] of [["empty", []], ["single", entries.slice(0, 1)], ["public-catalog", entries]] as const) {
    add(name, { id: "research-digest", payload: { entries: [...selected], manageUrl: `${url}/email` } });
  }
  add("notice", { id: "account-deletion-notice", payload: { noticeEndsAt: "13 September 2026", cancelUrl: url, exportUrl: `${url}/export` } });
  add("cancelled", { id: "account-deletion-cancelled", payload: { settingsUrl: url } });
  add("without-note", { id: "adult-subject-invitation", payload: { invitationUrl: url } });
  add("with-note", { id: "adult-subject-invitation", payload: { invitationUrl: url, note: "Synthetic invitation note." } });
  add("invitation", { id: "co-parent-invitation", payload: { invitationUrl: url } });
  for (const count of [1, 3]) for (const link of [false, true]) add(`count-${count}-${link ? "link" : "no-link"}`, {
    id: "embryo-upload-notice", payload: { embryoCount: count, ...(link ? { withdrawUrl: url } : {}) },
  });
  add("date-changed", { id: "record-key-addendum", payload: { kind: "date-changed", displayLabel: "Embryo 1", closingDateIso: "2028-09-06", closingDateWords: "6 September 2028" } });
  add("no-source", { id: "record-key-addendum", payload: { kind: "no-source", displayLabel: "Embryo 1" } });
  for (const count of [1, 3]) add(`card-invalidated-${count}`, { id: "record-key-addendum", payload: { kind: "card-invalidated", embryoCount: count } });
  for (const disposition of ["stored", "transferred", "donated", "discarded"] as const) add(disposition, {
    id: "embryo-disposition-notice", payload: { displayLabel: "Embryo 1", disposition, effectiveAt: "2026-09-06T12:00:00Z", retentionExpiresAt: "2028-09-06T12:00:00Z" },
  });
  for (const count of [1, 3]) add(`count-${count}`, { id: "cohort-restriction-notice", payload: { embryoCount: count } });
  add("expired", { id: "embryo-draft-expired", payload: {} });
  add("abandoned", { id: "embryo-ingest-abandoned", payload: {} });
  for (const kind of ["invitation-refused", "draft-cancelled", "donor-attribution-ended"] as const) {
    add(kind, { id: "invitation-terminal-notice", payload: { kind } });
  }
  return result;
}
