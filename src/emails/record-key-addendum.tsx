// A note that changes what a printed Record Key Card means. Three kinds:
// the closing date moved, no genetic file was kept for one embryo, or the
// cards were cancelled. Each kind renders its own sentence. The mail never
// carries a Record Key, an address or a laboratory label, and the cancelled
// kind carries no date at all, so it cannot be read as a new deadline.
import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface RecordKeyDateChangedProps {
  kind: "date-changed";
  displayLabel: string;
  closingDateIso: string;
  closingDateWords: string;
}

export interface RecordKeyNoSourceProps {
  kind: "no-source";
  displayLabel: string;
}

export interface RecordKeyCardInvalidatedProps {
  kind: "card-invalidated";
  embryoCount: number;
}

export type RecordKeyAddendumProps =
  | RecordKeyDateChangedProps
  | RecordKeyNoSourceProps
  | RecordKeyCardInvalidatedProps;

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

// Each kind returns its own layout so every heading is a literal the
// readability gate can read against the plain vocabulary.
export function RecordKeyAddendumEmail(props: RecordKeyAddendumProps) {
  if (props.kind === "date-changed") {
    return (
      <EmailLayout heading="The claim period on your Record Key changed">
        <Text style={paragraph}>
          The closing date for {props.displayLabel} on your Record Key Card is
          now {props.closingDateWords} ({props.closingDateIso}).
        </Text>
        <Text style={paragraph}>
          Keep this notice with the card. The date printed on the card no
          longer applies.
        </Text>
      </EmailLayout>
    );
  }
  if (props.kind === "no-source") {
    return (
      <EmailLayout heading="One embryo has no genetic file">
        <Text style={paragraph}>
          No genetic file was kept for {props.displayLabel}. Its Record Key
          Card cannot be used to claim anything, because nothing was stored
          for it.
        </Text>
      </EmailLayout>
    );
  }
  const cards =
    props.embryoCount === 1
      ? "The Record Key Card for 1 embryo record is"
      : `The Record Key Cards for ${props.embryoCount} embryo records are`;
  return (
    <EmailLayout heading="Every Record Key you were sent was cancelled">
      <Text style={paragraph}>
        {cards} no longer valid, and cannot be used to claim anything. Destroy
        any printed copies.
      </Text>
    </EmailLayout>
  );
}
