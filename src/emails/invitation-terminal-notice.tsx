import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface InvitationTerminalNoticeProps {
  kind: "invitation-refused" | "draft-cancelled" | "donor-attribution-ended";
}

const copy: Record<InvitationTerminalNoticeProps["kind"], { heading: string; body: string }> = {
  "invitation-refused": {
    heading: "Your invitation was declined",
    body: "The invitation can no longer be accepted. Other pending invitations to the same address have also been declined. You do not need an account or need to take any further action.",
  },
  "draft-cancelled": {
    heading: "An upload draft was cancelled",
    body: "An invitation needed for an upload draft was declined. That draft cannot be used to upload data. Its draft information and attached evidence are queued for deletion.",
  },
  "donor-attribution-ended": {
    heading: "The optional donor link has ended",
    body: "The draft will not name this donor. This decision alone does not cancel the embryo draft or delete embryo files. It does not give anyone access to a genome.",
  },
};

/** No names, addresses, draft labels, result details or credentials are accepted. */
export function InvitationTerminalNoticeEmail({ kind }: InvitationTerminalNoticeProps) {
  const message = copy[kind];
  return (
    <EmailLayout heading={message.heading}>
      <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted }}>{message.body}</Text>
    </EmailLayout>
  );
}
