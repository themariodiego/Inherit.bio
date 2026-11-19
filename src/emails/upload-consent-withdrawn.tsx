// The confirmation email for withdrawing the consent to store one's own DNA
// file (owner decision of 19 November 2026; brief §2.7, "with a confirmation
// email"). Queued in the same transaction as the emptying
// (empty_self_subject_with_notice_v1) and sent to the account's own confirmed
// address. It carries the moment of the withdrawal and nothing else: no link,
// no file name, no genetic value. The words are drafts for the owner's review
// (src/copy/upload/withdrawal.ts).
import { Text } from "@react-email/components";
import { OWN_UPLOAD_WITHDRAWAL_EMAIL_COPY as COPY } from "@/copy/upload/withdrawal";
import { EmailLayout, brand } from "./base";

export interface UploadConsentWithdrawnProps {
  /** When the withdrawal committed, as the database recorded it. */
  withdrawnAt: string;
}

const paragraph = { fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted } as const;

// "19 November 2026": the day in UTC, spelled out, so no reader parses a timestamp.
function dayInWords(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(iso));
}

export function UploadConsentWithdrawnEmail({ withdrawnAt }: UploadConsentWithdrawnProps) {
  return (
    <EmailLayout heading={COPY.heading}>
      <Text style={paragraph}>{COPY.withdrawnOn(dayInWords(withdrawnAt))}</Text>
      <Text style={paragraph}>{COPY.deleting}</Text>
      <Text style={paragraph}>{COPY.sharing}</Text>
      <Text style={paragraph}>{COPY.afterwards}</Text>
      <Text style={paragraph}>{COPY.security}</Text>
    </EmailLayout>
  );
}
