// Sent to the person an uploader named as the other genetic parent of a set
// of embryos. Nothing has been uploaded when this mail goes out. The reader
// decides alone: accept with their own account, or refuse. The link is built
// by the mail worker and carries an opaque token in the URL fragment; the
// mail never carries an address, a laboratory label or a Record Key.
import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface CoParentInvitationProps {
  invitationUrl: string;
}

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

export function CoParentInvitationEmail({ invitationUrl }: CoParentInvitationProps) {
  return (
    <EmailLayout heading="You were named as a genetic parent">
      <Text style={paragraph}>
        Someone preparing an embryo upload on Inherit named you as a genetic
        parent of those embryos. Nothing has been uploaded yet. This invitation
        gives the sender no access to any data of yours.
      </Text>
      <Text style={paragraph}>
        Accepting needs your own Inherit account and two signed statements. One
        says you are a genetic parent of these embryos. The other agrees to the
        upload. Refusing is one click, from the same link.
      </Text>
      <Text style={paragraph}>
        The link expires with the upload draft, 30 days after it was started.
        If nobody accepts by then, the draft closes and nothing is kept.
      </Text>
      <Button href={invitationUrl} style={button}>Review the invitation</Button>
    </EmailLayout>
  );
}
