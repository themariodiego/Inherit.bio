import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface FuturePersonOwnerNoticeProps { objectionUrl: string }

export function FuturePersonOwnerNoticeEmail({ objectionUrl }: FuturePersonOwnerNoticeProps) {
  return <EmailLayout heading="A claim needs your review">
    <Text style={{ fontSize: "16px", lineHeight: "1.6", color: brand.inkMuted }}>
      Someone has asked to claim a record you hold. The claim is pending.
      You can object within 30 days of this notice being delivered.
    </Text>
    <Text style={{ fontSize: "16px", lineHeight: "1.6", color: brand.inkMuted }}>
      Open your link to see the exact closing date and send an objection.
      You do not need to share the link with anyone.
    </Text>
    <Button href={objectionUrl} style={{ backgroundColor: brand.forest, color: brand.paper,
      padding: "14px 22px", borderRadius: "8px", textDecoration: "none", fontSize: "16px" }}>
      Review the claim
    </Button>
  </EmailLayout>;
}
