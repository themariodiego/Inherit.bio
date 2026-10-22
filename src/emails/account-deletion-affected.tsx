import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AccountDeletionAffectedProps { noticeEndsAt: string }
export interface AccountDeletionAffectedCancelledProps { cancelledAt: string }

const paragraph = { fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted };
function dateWords(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

export function AccountDeletionAffectedEmail({ noticeEndsAt }: AccountDeletionAffectedProps) {
  return <EmailLayout heading="Data will be deleted">
    <Text style={paragraph}>An account that holds records involving you has asked to close.
      Records still held by that account will be deleted after {dateWords(noticeEndsAt)}.
      This request will not destroy records before that notice period ends.</Text>
    <Text style={paragraph}>Copies already held in your own account stay separate.
      This notice gives no new access to records.</Text>
  </EmailLayout>;
}

export function AccountDeletionAffectedCancelledEmail({ cancelledAt }: AccountDeletionAffectedCancelledProps) {
  return <EmailLayout heading="Record deletion cancelled">
    <Text style={paragraph}>The account that asked to close cancelled that request on {dateWords(cancelledAt)}.</Text>
    <Text style={paragraph}>Records or consent already withdrawn, deleted, moved, restricted
      or expired stay that way. This notice gives no new access to records.</Text>
  </EmailLayout>;
}
