import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AccountDeletionNoticeProps {
  noticeEndsAt: string;
  cancelUrl: string;
  exportUrl: string;
}

// "3 October 2026 at 11:51 UTC": the moment the notice period ends, spelled
// out in UTC so that no reader has to parse a timestamp.
function deadlineInWords(iso: string): string {
  const moment = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(moment);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(moment);
  return `${date} at ${time} UTC`;
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
        Your Inherit account is scheduled for deletion on{" "}
        {deadlineInWords(noticeEndsAt)}. No
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
        Your deletion request was cancelled. No data had been destroyed yet.
        Data you had already revoked, moved, restricted or let expire is not
        restored.
      </Text>
      <Button href={settingsUrl} style={button}>
        Open data settings
      </Button>
    </EmailLayout>
  );
}
