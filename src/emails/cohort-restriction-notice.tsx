// Sent to every genetic parent when one of them withdraws a set of embryo
// records. It states what is already true (derived results are unreadable)
// and what follows (source files deleted within 7 days). No link: there is
// nothing left to act on. The mail never carries a Record Key, an address,
// a laboratory label or a genetic result.
import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface CohortRestrictionNoticeProps {
  embryoCount: number;
}

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

export function CohortRestrictionNoticeEmail({ embryoCount }: CohortRestrictionNoticeProps) {
  const records = embryoCount === 1 ? "1 embryo record" : `${embryoCount} embryo records`;
  return (
    <EmailLayout heading="Embryo data will be deleted">
      <Text style={paragraph}>
        A genetic parent withdrew {records} from Inherit. One parent
        withdrawing applies to the whole set, for everyone on it.
      </Text>
      <Text style={paragraph}>
        Derived results for these embryos are already unreadable. The source
        files are deleted within 7 days.
      </Text>
      <Text style={paragraph}>
        Record Key Cards for these embryos no longer work, and no further
        analysis will run.
      </Text>
    </EmailLayout>
  );
}
