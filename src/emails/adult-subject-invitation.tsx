import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AdultSubjectInvitationProps {
  invitationUrl: string;
}

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

export function AdultSubjectInvitationEmail({ invitationUrl }: AdultSubjectInvitationProps) {
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
      <Button href={invitationUrl} style={button}>Review the invitation</Button>
    </EmailLayout>
  );
}
