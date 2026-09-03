import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AdultSubjectInvitationProps {
  invitationUrl: string;
  /**
   * The optional note the inviter wrote. It renders as words, never as a
   * link and never inside the invitation button, so nothing the inviter
   * types can become a destination in this mail.
   */
  note?: string;
}

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

export function AdultSubjectInvitationEmail({ invitationUrl, note }: AdultSubjectInvitationProps) {
  return (
    <EmailLayout heading="You were invited to Inherit">
      <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted }}>
        Someone asked to connect with you for a future family-data flow. No
        genetic file has been added for you, and this invitation gives the
        sender no access to your genetic data.
      </Text>
      <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted }}>
        You can accept through your own account, refuse, or delete the reserved
        record. The link expires after 30 days.
      </Text>
      {note ? (
        <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.ink }}>
          They wrote: {note}
        </Text>
      ) : null}
      <Button href={invitationUrl} style={button}>Review the invitation</Button>
    </EmailLayout>
  );
}
