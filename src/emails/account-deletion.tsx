import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AccountDeletionNoticeProps {
  noticeEndsAt: string;
  cancelUrl: string;
  exportUrl: string;
}

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

export function AccountDeletionNoticeEmail({
  noticeEndsAt,
  cancelUrl,
  exportUrl,
}: AccountDeletionNoticeProps) {
  return (
    <EmailLayout heading="Your account deletion is scheduled">
      <Text
        style={{
          fontSize: "14px",
          lineHeight: "1.6",
          color: brand.inkMuted,
        }}
      >
        Your Inherit account is scheduled for deletion on {noticeEndsAt}. No
        physical deletion will begin before then. You can export your data or
        cancel the request during the notice period.
      </Text>
      <Button href={cancelUrl} style={button}>
        Review or cancel
      </Button>
      <Text style={{ fontSize: "13px" }}>
        <a href={exportUrl} style={{ color: brand.forest }}>
          Export your data
        </a>
      </Text>
    </EmailLayout>
  );
}

export interface AccountDeletionCancelledProps {
  settingsUrl: string;
}

export function AccountDeletionCancelledEmail({
  settingsUrl,
}: AccountDeletionCancelledProps) {
  return (
    <EmailLayout heading="Account deletion cancelled">
      <Text
        style={{
          fontSize: "14px",
          lineHeight: "1.6",
          color: brand.inkMuted,
        }}
      >
        Your deletion request was cancelled before physical deletion began.
        Separately revoked, transferred, restricted, or expired data is not
        restored.
      </Text>
      <Button href={settingsUrl} style={button}>
        Open data settings
      </Button>
    </EmailLayout>
  );
}
