import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface ReportReadyProps {
  reportCount: number;
  dashboardUrl: string;
}

export function ReportReadyEmail({
  reportCount,
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
        We finished processing your genome file.{" "}
        {`${reportCount} report${reportCount === 1 ? " is" : "s are"} ready on your dashboard.`}
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
