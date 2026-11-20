import { Text } from "@react-email/components";
import { ADULT_ACCEPTANCE_SECOND_NOTICE_COPY, ADULT_REVOCATION_RENOTICE_COPY } from "@/copy/upload/other-adult-acceptance-notices";
import { UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY } from "@/copy/upload/other-adult-withdrawal";
import { EmailLayout, brand } from "./base";

export interface InvitationTerminalNoticeProps {
  kind: "invitation-refused" | "draft-cancelled" | "donor-attribution-ended" | "upload-permission-withdrawn"
    | "adult-acceptance-second-notice" | "adult-revocation-renotice";
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
  // 20261119160000: the uploader of another adult's file withdrew its
  // permission and everything it added was deleted (owner decision of 19
  // November 2026). The words are drafts for the owner's review.
  "upload-permission-withdrawn": UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY,
  // 20261120120000 (D-141): the second notice 72 hours after an account
  // created from the invitation accepted it, and the re-notice 30 days after
  // any account acceptance. The words are drafts for the owner's review.
  "adult-acceptance-second-notice": ADULT_ACCEPTANCE_SECOND_NOTICE_COPY,
  "adult-revocation-renotice": ADULT_REVOCATION_RENOTICE_COPY,
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
