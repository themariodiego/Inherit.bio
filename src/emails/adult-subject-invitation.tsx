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
  /**
   * Set for the register's Path B request ("I have their file", TEST-LOCAL
   * only): the person is asked to sign for a file someone already holds,
   * with no account, instead of being invited to use their own.
   */
  request?: "esignature";
}

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

const paragraph = { fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted } as const;

export function AdultSubjectInvitationEmail({ invitationUrl, note, request }: AdultSubjectInvitationProps) {
  if (request === "esignature") {
    return (
      <EmailLayout heading="A request to add your DNA file to Inherit">
        <Text style={paragraph}>
          Someone who has a file of your DNA asked to add it to Inherit. Nothing
          is added until you sign, and you do not need an account.
        </Text>
        <Text style={paragraph}>
          If you sign, you are asked again about each file they add, and nothing
          is made from a file until you say yes. You can refuse or delete the
          request instead. The link expires after 30 days.
        </Text>
        <Button href={invitationUrl} style={button}>Review the request</Button>
      </EmailLayout>
    );
  }
  return (
    <EmailLayout heading="You were invited to Inherit">
      <Text style={paragraph}>
        Someone asked to connect with you for a future family-data flow. No
        genetic file has been added for you, and this invitation gives the
        sender no access to your genetic data.
      </Text>
      <Text style={paragraph}>
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
