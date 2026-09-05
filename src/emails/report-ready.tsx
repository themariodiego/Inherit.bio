import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";
import { REPORT_READY_BODY } from "@/copy/reports/strings";

export interface ReportReadyProps {
  /** Legacy queue payload compatibility only; never a combined visible total. */
  reportCount: number;
  dashboardUrl: string;
}

export function ReportReadyEmail({
  dashboardUrl,
}: ReportReadyProps) {
  return (
    <EmailLayout heading="Your reports are ready">
      <Text
        style={{
          fontSize: "14px",
          lineHeight: "1.6",
          color: brand.inkMuted,
          margin: 0,
        }}
      >
        {REPORT_READY_BODY}
      </Text>
      <Button
        href={dashboardUrl}
        style={{
          display: "inline-block",
          backgroundColor: brand.forest,
          color: brand.paper,
          textDecoration: "none",
          padding: "10px 20px",
          borderRadius: "9999px",
          fontSize: "14px",
          marginTop: "16px",
        }}
      >
        View your reports
      </Button>
    </EmailLayout>
  );
}
