import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

/** Fixed minimal request. The sender passes no identity, record, evidence,
 * reviewer basis, closing-date change or access authority into this renderer. */
export function FuturePersonMoreInformationEmail() {
  return <EmailLayout heading="We need more details">
    <Text style={{ fontSize: "16px", lineHeight: "1.6", color: brand.inkMuted }}>
      Please reply with more information about your request.
      Your request stays pending, and its closing date stays the same.
    </Text>
    <Text style={{ fontSize: "16px", lineHeight: "1.6", color: brand.inkMuted }}>
      Do not send identity documents, genetic data, keys or access links by email.
      This message gives no access to a record.
    </Text>
  </EmailLayout>;
}
