// A terminal notice to the uploader whose embryo upload draft closed after
// 30 days. It carries no link and no data: nothing was uploaded, and nothing
// is kept. The component takes no props; the empty type keeps the template
// registry uniform.
import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export type EmbryoDraftExpiredProps = Record<string, never>;

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

export function EmbryoDraftExpiredEmail() {
  return (
    <EmailLayout heading="An embryo upload expired">
      <Text style={paragraph}>
        An embryo upload draft you started on Inherit closed after 30 days
        without being finished. Nothing was uploaded, and nothing is kept.
      </Text>
      <Text style={paragraph}>
        Any invitation sent for that draft no longer works.
      </Text>
    </EmailLayout>
  );
}
