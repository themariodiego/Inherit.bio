// Sent to every genetic parent on an embryo set the moment its records are
// added. It lists exactly what was stored (a count of embryo records, added
// today) and what was not (no results, no laboratory labels). The withdraw
// link is present only when the mail worker built one from a delivery token;
// the mail never carries an address or a Record Key.
import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface EmbryoUploadNoticeProps {
  embryoCount: number;
  /** Built server-side from the delivery token; absent when the reader has no withdraw link. */
  withdrawUrl?: string;
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

export function EmbryoUploadNoticeEmail({ embryoCount, withdrawUrl }: EmbryoUploadNoticeProps) {
  const records = embryoCount === 1 ? "1 embryo record" : `${embryoCount} embryo records`;
  const verb = embryoCount === 1 ? "was" : "were";
  return (
    <EmailLayout heading="Embryos were added to Inherit">
      <Text style={paragraph}>
        Today, {records} {verb} added on Inherit to a set of embryos that names
        you as a genetic parent.
      </Text>
      <Text style={paragraph}>
        What was stored: {records}, added today.
      </Text>
      <Text style={paragraph}>
        What was not stored: no results, and no laboratory labels.
      </Text>
      {withdrawUrl ? (
        <>
          <Text style={paragraph}>
            You can withdraw at any time. Withdrawing deletes these records and
            stops any analysis of them.
          </Text>
          <Button href={withdrawUrl} style={button}>Review your options</Button>
        </>
      ) : null}
    </EmailLayout>
  );
}
