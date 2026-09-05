import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

/** No payload, key, date, subject label, genetic finding or source identifier. */
export type EmbryoIngestAbandonedProps = Record<string, never>;

export function EmbryoIngestAbandonedEmail() {
  return (
    <EmailLayout heading="The embryo upload ended">
      <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted }}>
        The upload did not complete. No genetic source file from this upload is
        retained by Inherit.
      </Text>
      <Text style={{ fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted }}>
        Every Record Key Card issued for this upload is invalid and cannot be
        used to claim a record. Destroy any printed copies.
      </Text>
    </EmailLayout>
  );
}
